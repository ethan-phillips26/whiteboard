// Runs inside the dashboard's tab, but in the extension's world. The page itself
// cannot reach chrome.runtime — and Firefox has no externally_connectable to give it
// a way — so it posts here and this relays to the worker.
//
// Only messages the page posted to itself are taken: an iframe inside the page is a
// different `source`, and must not be able to borrow the page's access.

const REQUEST = "whiteboard:request";
const RESPONSE = "whiteboard:response";

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.kind !== REQUEST) return;
  const { id, msg } = e.data;
  const answer = (reply) => window.postMessage({ kind: RESPONSE, id, reply }, location.origin);
  chrome.runtime.sendMessage(msg).then(answer, (err) =>
    // Most often the extension was reloaded under an open page.
    answer({ error: "extension", message: String(err?.message || err) }));
});

// A second, longer-lived channel for the Claude tab: one port to the extension's
// worker, which relays it to the native host. Requests above are one question and
// one answer; a conversation streams, so it needs a connection instead.
const PORT = "whiteboard:port";
const PORT_EVENT = "whiteboard:port-event";
const ports = new Map();

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.kind !== PORT) return;
  const { op, port: n, msg } = e.data;
  const tell = (extra) =>
    window.postMessage({ kind: PORT_EVENT, port: n, ...extra }, location.origin);
  if (op === "open") {
    if (ports.has(n)) return;
    let p;
    try {
      p = chrome.runtime.connect({ name: "claude" });
    } catch (err) {
      tell({ op: "disconnect", message: String(err?.message || err) });
      return;
    }
    ports.set(n, p);
    p.onMessage.addListener((m) => tell({ op: "message", msg: m }));
    p.onDisconnect.addListener(() => {
      ports.delete(n);
      tell({ op: "disconnect", message: chrome.runtime.lastError?.message ?? null });
    });
  } else if (op === "send") {
    ports.get(n)?.postMessage(msg);
  } else if (op === "close") {
    ports.get(n)?.disconnect();
    ports.delete(n);
  }
});
