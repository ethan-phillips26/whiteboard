// The only code that talks to Blackboard. The page and the bridge ask; this file
// decides what is allowed — GET, under the public REST API, on the one host the
// person connected — so the read-only rule is enforced here rather than trusted to
// whichever page is asking.

// Chrome runs this as a service worker and needs the import; Firefox has no MV3
// service workers, runs `background.scripts` instead, and loads origin.js from there.
if (typeof importScripts === "function") importScripts("origin.js");

const API_PREFIX = "/learn/api/public/";
const ORIGIN_RULE_ID = 1;

// Pages allowed to ask: the dashboard's own path, not merely its origin. Every
// GitHub Pages project on ethanphillips.dev shares that one origin, and none of the
// others has any business reading Blackboard. The manifest only injects the bridge
// here too; this is the check that still holds if it ever grows a broader pattern.
const PAGES = [
  { origin: "https://ethanphillips.dev", path: "/whiteboard/" },
];

async function currentHost() {
  return (await chrome.storage.local.get("host")).host || null;
}

function granted(origin) {
  return chrome.permissions.contains({ origins: [hostPattern(origin)] });
}

// Blackboard answers 403 to any request whose Origin is not its own (measured:
// `chrome-extension://…` and `null` both get it). Chrome sends no Origin on these GETs
// at all, so there this rule is a no-op; it is insurance for any browser that does,
// where the failure would otherwise be every request refused. The rule only matches
// requests made outside any tab — this worker — so Blackboard's own pages open in the
// person's tabs are untouched. Session rules do not survive a browser restart, which
// is why this runs every time the worker starts, not just on install.
async function installOriginRule(origin) {
  const addRules = origin ? [{
    id: ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "origin", operation: "remove" }],
    },
    condition: {
      urlFilter: `|${origin}/`,
      tabIds: [chrome.tabs.TAB_ID_NONE],
      resourceTypes: ["xmlhttprequest"],
    },
  }] : [];
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ORIGIN_RULE_ID],
    addRules,
  });
}

currentHost().then(installOriginRule);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "host" in changes) installOriginRule(changes.host.newValue || null);
});

async function apiGet(path) {
  const origin = await currentHost();
  if (!origin || !(await granted(origin))) return { error: "not-connected" };

  // Resolved first, checked after: the URL parser has already collapsed any `..`,
  // and a full URL to another host comes out with a different origin.
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith(API_PREFIX)) {
    return { error: "refused", message: `Only ${API_PREFIX}… on ${origin} can be read.` };
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    return { error: "network", message: String(e?.message || e) };
  }

  // An expired session redirects to the login page rather than answering 401…
  if (resp.type === "opaqueredirect" || resp.status === 401) {
    return { error: "signed-out", status: resp.status };
  }
  // …but 403 is a live session looking at something closed to students, like a
  // hidden gradebook. Callers skip it; it is not a reason to sign in again.
  if (resp.status === 403) return { error: "forbidden", status: 403 };

  const ctype = resp.headers.get("content-type") || "";
  // …and some configurations answer 200 with the login page's HTML instead.
  if (!ctype.includes("json")) return { error: "signed-out", status: resp.status };

  const data = await resp.json().catch(() => null);
  if (!resp.ok) return { error: "http", status: resp.status, data };
  return { ok: true, status: resp.status, data };
}

// A file may live under the API or at one of Ultra's own file links; nothing
// else on the host is fetched as a file.
const FILE_PREFIXES = [API_PREFIX, "/bbcswebdav/"];
// Chrome caps a message at 64MB, and base64 grows a file by a third.
const MAX_FILE = 32 * 1024 * 1024;

// Where each request from this worker was redirected. A download refused on its
// way to storage fails with only "Failed to fetch", and the host it was sent to is
// what a person needs to allow — Blackboard's hosted Learn uses its CDN, but where
// a school keeps its files is the school's business. The event fires for the hops
// on hosts already allowed, which is exactly the hop that names the next host.
const redirects = new Map();
chrome.webRequest.onBeforeRedirect.addListener((details) => {
  if (details.tabId === chrome.tabs.TAB_ID_NONE) redirects.set(details.url, details.redirectUrl);
}, { urls: ["<all_urls>"] });

/** Where a request finally ended up, or null if it was never redirected. */
function redirectedTo(url) {
  let target = url;
  const seen = new Set();
  while (redirects.has(target) && !seen.has(target)) {
    seen.add(target);
    const next = redirects.get(target);
    redirects.delete(target);
    target = next;
  }
  return target === url ? null : target;
}

async function rememberFileHost(pattern) {
  const { fileHosts = [] } = await chrome.storage.local.get("fileHosts");
  if (!fileHosts.includes(pattern)) {
    await chrome.storage.local.set({ fileHosts: [...fileHosts, pattern] });
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fileGet(path) {
  const origin = await currentHost();
  if (!origin || !(await granted(origin))) return { error: "not-connected" };
  const url = new URL(path, origin);
  if (url.origin !== origin || !FILE_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    return { error: "refused", message: `Only files on ${origin} can be fetched.` };
  }

  let resp;
  try {
    // Followed, unlike apiGet: the download endpoint answers with a redirect to
    // where the file is stored, and following it is the only way to the bytes.
    resp = await fetch(url, { credentials: "include" });
  } catch (e) {
    // Without permission for the host a redirect lands on, the browser withholds
    // the response. When that permission is what is missing, name the host and
    // remember it, so the next "Allow access" asks for it: that is the fix, and
    // it is one click away.
    //
    // Firefox delivers webRequest events asynchronously, and the failed fetch can
    // settle before the redirect event arrives, so give it a moment to catch up.
    for (let i = 0; i < 10 && !redirects.has(url.href); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const target = redirectedTo(url.href);
    const where = target ? new URL(target) : null;
    const patterns = where ? [`${where.protocol}//${where.hostname}/*`] : FILE_STORAGE;
    if (!(await chrome.permissions.contains({ origins: patterns }))) {
      if (where) await rememberFileHost(patterns[0]);
      return {
        error: "needs-file-access",
        message: `Blackboard keeps this file on ${where?.hostname ?? "its storage server"}, ` +
          "which Whiteboard hasn't been allowed to read yet. Click the Whiteboard " +
          "Connector icon in your browser's extensions menu, press Allow access, then " +
          "try again.",
      };
    }
    return {
      error: "network",
      message: `${e?.message || e}` + (where ? ` (on ${where.hostname})` : "") +
        ". Blackboard may keep this file on a server the extension can't reach — " +
        "open it in Blackboard instead.",
    };
  }
  redirectedTo(url.href); // done with this request's redirects
  // The one redirect that means something else: back to the login page.
  if (resp.status === 401 || /\/webapps\/login/.test(new URL(resp.url).pathname)) {
    return { error: "signed-out", status: resp.status };
  }
  if (resp.status === 403) return { error: "forbidden", status: 403 };
  if (!resp.ok) return { error: "http", status: resp.status };

  const tooBig = { error: "too-large", message: "That file is too large to fetch here." };
  if (Number(resp.headers.get("content-length") || 0) > MAX_FILE) return tooBig;
  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength > MAX_FILE) return tooBig;
  return {
    ok: true,
    status: resp.status,
    type: resp.headers.get("content-type") || "",
    disposition: resp.headers.get("content-disposition"),
    bytes: buffer.byteLength,
    base64: toBase64(buffer),
  };
}

async function disconnect() {
  const origin = await currentHost();
  const { fileHosts = [] } = await chrome.storage.local.get("fileHosts");
  await chrome.storage.local.remove(["host", "fileHosts"]);
  // The permissions go too: disconnecting should leave nothing that still lets
  // this extension read Blackboard or its files. A permission the manifest
  // granted outright cannot be removed, which is not worth failing over.
  if (origin) {
    await chrome.permissions.remove({ origins: connectPatterns(origin, fileHosts) })
      .catch(() => {});
  }
  return { ok: true };
}

async function closeLoginTab() {
  const { loginTab } = await chrome.storage.session.get("loginTab");
  if (loginTab == null) return;
  await chrome.storage.session.remove("loginTab");
  await chrome.tabs.remove(loginTab).catch(() => {}); // already closed by hand
}

async function status() {
  const origin = await currentHost();
  if (!origin) return { state: "not-connected" };
  if (!(await granted(origin))) return { state: "needs-permission", host: origin };

  // A BbRouter cookie proves nothing on its own — Blackboard hands one to anonymous
  // visitors — so "signed in" means users/me answered with a user.
  const me = await apiGet("/learn/api/public/v1/users/me");
  if (me.ok && me.data?.id) {
    await closeLoginTab();
    return { state: "signed-in", host: origin, user: me.data };
  }
  if (me.error === "signed-out") return { state: "signed-out", host: origin };
  return { state: "error", host: origin, detail: me };
}

async function connect(raw) {
  const origin = blackboardOrigin(raw);
  await chrome.storage.local.set({ host: origin });
  if (await granted(origin)) return status();
  // A permission prompt has to come from a click on one of the extension's own
  // pages. The page that asked belongs to somebody else, so open ours to ask.
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`connect.html?host=${encodeURIComponent(origin)}`),
  });
  return { state: "needs-permission", host: origin };
}

async function signIn() {
  const origin = await currentHost();
  if (!origin) return { error: "not-connected" };
  // Blackboard's front door, not a login URL: every institution sends it on to its
  // own identity provider, and a URL built here would be right at only some of them.
  const tab = await chrome.tabs.create({ url: `${origin}/` });
  await chrome.storage.session.set({ loginTab: tab.id });
  return { ok: true };
}

async function handle(msg, sender) {
  // `sender.origin` is Chrome's; the url is there in every browser.
  const from = sender.origin || (sender.url ? new URL(sender.url).origin : "");
  const path = sender.url ? new URL(sender.url).pathname : "";
  const own = from === self.location.origin;
  if (!own && !PAGES.some((p) => p.origin === from && path.startsWith(p.path))) {
    return { error: "refused", message: "This page is not allowed to use the extension." };
  }
  switch (msg?.type) {
    case "ping": return { ok: true, version: chrome.runtime.getManifest().version };
    case "status": return status();
    case "connect": return connect(msg.host);
    case "signin": return signIn();
    case "get": return apiGet(String(msg.path || ""));
    case "file": return fileGet(String(msg.path || ""));
    case "host": return { host: await currentHost() };
    case "disconnect": return disconnect();
    default: return { error: "unknown", message: `No such request: ${msg?.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, (e) => reply({ error: "exception", message: String(e?.message || e) }));
  return true; // the reply is asynchronous
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("connect.html") });
});
