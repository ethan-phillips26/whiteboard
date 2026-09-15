// What a GitHub Pages copy of Whiteboard would be, minus the dashboard. It never
// talks to Blackboard — a web page can't, because of CORS — it asks the extension,
// through the bridge, and renders whatever comes back.

const $ = (id) => document.getElementById(id);
const REQUEST = "whiteboard:request";
const RESPONSE = "whiteboard:response";
const DAY = 864e5;

let nextId = 0;
const waiting = new Map();

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.kind !== RESPONSE) return;
  const done = waiting.get(e.data.id);
  if (done) {
    waiting.delete(e.data.id);
    done(e.data.reply);
  }
});

function ext(msg, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    window.postMessage({ kind: REQUEST, id, msg }, location.origin);
    setTimeout(() => {
      if (waiting.delete(id)) reject(new Error("The extension did not answer."));
    }, timeout);
  });
}

// ------------------------------------------------------------------ requests

function log(path, reply, ms) {
  const li = document.createElement("li");
  const outcome = reply.ok ? reply.status : `${reply.error}${reply.status ? " " + reply.status : ""}`;
  li.textContent = `GET ${path} → ${outcome} · ${Math.round(ms)}ms`;
  $("log").append(li);
  $("log-count").textContent = $("log").children.length;
}

async function get(path) {
  const started = performance.now();
  const reply = await ext({ type: "get", path });
  log(path, reply, performance.now() - started);
  if (reply.ok) return reply.data;
  const err = new Error(reply.message || reply.error);
  err.code = reply.error;
  throw err;
}

async function paged(path) {
  const out = [];
  const seen = new Set();
  let next = path;
  while (next && !seen.has(next)) {
    seen.add(next);
    const data = await get(next);
    if (!Array.isArray(data.results)) return [data];
    out.push(...data.results);
    next = data.paging?.nextPage;
  }
  return out;
}

async function eachLimited(items, limit, fn) {
  const queue = [...items];
  const worker = async () => { while (queue.length) await fn(queue.shift()); };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

// Calculated columns ("Weighted Total") carry points like real work does; the same
// rule as client.is_assignment_column.
function isCoursework(col) {
  if (col.grading?.type === "Calculated") return false;
  if (col.scoreProviderHandle === "resource/x-bb-calculatedgrade") return false;
  return col.calculatedColumn == null;
}

// --------------------------------------------------------------------- screens

const SECTIONS = ["install", "connect", "signin", "dash"];
const show = (name) => SECTIONS.forEach((s) => ($(s).hidden = s !== name));

function row(title, sub, right) {
  const li = document.createElement("li");
  const left = document.createElement("span");
  left.textContent = title;
  if (sub) {
    const small = document.createElement("span");
    small.className = "sub";
    small.textContent = sub;
    left.append(small);
  }
  li.append(left);
  if (right) {
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = right;
    li.append(when);
  }
  return li;
}

function fill(list, items, empty) {
  $(list).replaceChildren(...(items.length ? items : [row(empty)]));
}

let loaded = false;

async function loadDashboard({ user, host }) {
  if (loaded) return;
  loaded = true;
  const name = [user.name?.given, user.name?.family].filter(Boolean).join(" ");
  $("who").textContent = name || user.userName || user.id;
  $("where").textContent = new URL(host).hostname;

  try {
    const memberships = await paged(
      `/learn/api/public/v1/users/${encodeURIComponent(user.id)}/courses?expand=course&limit=200`);
    const courses = memberships
      .map((m) => m.course)
      .filter((c) => c && !c.organization && ["Yes", "Term"].includes(c.availability?.available))
      .sort((a, b) => a.name.localeCompare(b.name));
    fill("courses", courses.map((c) => row(c.name, c.courseId)), "No courses.");

    const now = Date.now();
    const due = [];
    await eachLimited(courses, 4, async (course) => {
      let cols;
      try {
        cols = await paged(`/learn/api/public/v2/courses/${course.id}/gradebook/columns?limit=200`);
      } catch (e) {
        if (e.code === "forbidden") return; // a hidden gradebook: skip the course
        throw e;
      }
      for (const col of cols) {
        const t = Date.parse(col.grading?.due);
        if (isCoursework(col) && t >= now - DAY && t <= now + 60 * DAY) {
          due.push({ name: col.name, course: course.name, t });
        }
      }
    });
    due.sort((a, b) => a.t - b.t);
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
    fill("due", due.map((d) => row(d.name, d.course, fmt.format(d.t))), "Nothing due.");
  } catch (e) {
    loaded = false;
    if (e.code === "signed-out") return refresh();
    $("dash-error").textContent = `Couldn't load: ${e.message}`;
  }
}

// ----------------------------------------------------------------------- flow

let poll = null;
const stopPolling = () => { clearInterval(poll); poll = null; };

// The sign-in and permission steps happen in other tabs this page can't see into,
// so it asks the extension how things stand until they change.
function pollUntil(done) {
  stopPolling();
  const started = Date.now();
  poll = setInterval(async () => {
    const s = await ext({ type: "status" }).catch(() => null);
    if (s && (done(s) || Date.now() - started > 5 * 60e3)) {
      stopPolling();
      refresh();
    }
  }, 1500);
}

async function refresh() {
  const s = await ext({ type: "status" });
  $("state").textContent = s.state;
  switch (s.state) {
    case "not-connected":
      show("connect");
      break;
    case "needs-permission":
      show("connect");
      $("host").value = new URL(s.host).hostname;
      $("connect-note").textContent = `Allow access to ${new URL(s.host).hostname} in the tab that opened.`;
      break;
    case "signed-out":
      show("signin");
      $("signin-host").textContent = new URL(s.host).hostname;
      break;
    case "signed-in":
      show("dash");
      await loadDashboard(s);
      break;
    default:
      show("connect");
      $("connect-note").textContent = `Blackboard answered unexpectedly: ${JSON.stringify(s.detail)}`;
  }
}

$("connect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { localStorage.setItem("whiteboard-host", $("host").value); } catch {}
  const s = await ext({ type: "connect", host: $("host").value });
  if (s.error) {
    $("connect-note").textContent = s.message || s.error;
    return;
  }
  await refresh();
  if (s.state === "needs-permission") {
    pollUntil((x) => x.state !== "needs-permission" && x.state !== "not-connected");
  }
});

$("signin-btn").addEventListener("click", async () => {
  await ext({ type: "signin" });
  $("signin-note").textContent = "Sign in in the new tab — this page will notice when you're done.";
  pollUntil((s) => s.state === "signed-in");
});

(async () => {
  try { $("host").value = localStorage.getItem("whiteboard-host") || ""; } catch {}
  try {
    await ext({ type: "ping" }, 1000);
  } catch {
    $("state").textContent = "no extension";
    show("install");
    return;
  }
  refresh();
})();
