/*
 * The service worker, which exists for exactly one thing: letting a <video>
 * element play a lecture recording that is far too big to fetch whole.
 *
 * A media element streams by asking for byte ranges and expecting 206 answers.
 * Nothing in the page can give it those — the bytes live behind the extension,
 * which the element cannot ask — so this sits in between: it answers requests
 * under <scope>/stream/ by asking the page for the range, and the page asks the
 * extension. Seeking works because the element is talking to something that
 * really does speak Range.
 *
 * It caches nothing and claims nothing else. Every other request returns from
 * this handler untouched, which means the browser fetches it exactly as if no
 * worker were installed at all — the site's updates behave as they always have.
 */

const STREAM = new URL("stream/", self.registration.scope).pathname;

// Long enough for a slow chunk on a bad connection; short enough that a dead
// page does not leave the video element waiting on a promise forever.
const PATIENCE_MS = 60000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/** `bytes=1048576-` → `{ first, last }`, with last null for an open end. */
function parseRange(header) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header || "").trim());
  if (!match) return { first: 0, last: null };
  return {
    first: match[1] ? Number(match[1]) : 0,
    last: match[2] ? Number(match[2]) : null,
  };
}

/**
 * Ask the page for one range.
 *
 * The worker cannot reach the extension itself, so it asks a window it controls
 * and that window relays. `event.clientId` is empty for a media request in some
 * browsers, so the caller falls back to whichever window is open.
 */
function askOne(client, message) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("The page did not answer.")), PATIENCE_MS);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      if (e.data?.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    client.postMessage(message, [channel.port2]);
  });
}

async function askPage(clientId, message) {
  // A media request often carries no clientId, and then the tab that owns this
  // video has to be found rather than assumed. There is usually more than one
  // window — this app sends you to Blackboard and to Google in tabs of their own
  // — so "the first one" is as likely to be a tab that never minted this id and
  // has never heard of it. Ask each until one owns it.
  const named = clientId ? await self.clients.get(clientId) : null;
  const windows = await self.clients.matchAll({ type: "window" });
  const candidates = named
    ? [named, ...windows.filter((c) => c.id !== named.id)]
    : windows;
  if (!candidates.length) throw new Error("Whiteboard isn't open in any tab.");

  let refused = null;
  for (const client of candidates) {
    try {
      return await askOne(client, message);
    } catch (e) {
      // A tab that does not own the stream says so at once; only an unresponsive
      // one costs the wait, and then the next tab is still worth trying.
      refused = e;
    }
  }
  throw refused ?? new Error("No tab answered for that video.");
}

async function stream(request, clientId) {
  const id = new URL(request.url).pathname.slice(STREAM.length);
  const { first, last } = parseRange(request.headers.get("range"));

  let slice;
  try {
    slice = await askPage(clientId, { kind: "whiteboard:range", id, start: first, end: last });
  } catch (e) {
    // 502 rather than a thrown fetch: the element shows its own error, and the
    // reason reaches the page's console instead of vanishing.
    return new Response(`Whiteboard could not read that range: ${e.message}`,
      { status: 502, headers: { "Content-Type": "text/plain" } });
  }

  const { buffer, total, type } = slice;
  const end = first + buffer.byteLength - 1;
  // A total the server would not state leaves the element unable to seek, but
  // still able to play what it is given: "*" is the honest answer for it.
  const range = `bytes ${first}-${end}/${total ?? "*"}`;

  return new Response(buffer, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": type || "application/octet-stream",
      "Content-Length": String(buffer.byteLength),
      "Content-Range": range,
      "Accept-Ranges": "bytes",
      // The bytes belong to one Blackboard session; nothing about them should
      // outlive the tab in a cache the browser manages on its own.
      "Cache-Control": "no-store",
    },
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Anything that is not a stream is left entirely alone: no respondWith, so the
  // browser handles it as though this worker did not exist.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(STREAM)) return;
  event.respondWith(stream(event.request, event.clientId));
});
