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
