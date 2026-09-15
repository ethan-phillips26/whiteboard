// The page's only way to Blackboard: the Whiteboard Connector extension,
// reached through the content script it puts in this page (extension/bridge.js).
// A web page cannot read another site's data, so every request is the extension's;
// this page only asks, and renders what comes back.

const REQUEST = "whiteboard:request";
const RESPONSE = "whiteboard:response";

let nextId = 0;
const waiting = new Map();
let listening = false;

// Started by the first request rather than on import, so a module that merely
// imports this one — a component rendered in a test, say — needs no window.
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.kind !== RESPONSE) return;
    const done = waiting.get(e.data.id);
    if (done) {
      waiting.delete(e.data.id);
      done(e.data.reply);
    }
  });
}

export class ExtensionMissing extends Error {
  constructor() {
    super("The Whiteboard Connector extension did not answer.");
    this.reason = "no-extension";
  }
}

/** One request to the extension. Its reply is data, never thrown. */
export function ask(msg, timeout = 60000) {
  listen();
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    window.postMessage({ kind: REQUEST, id, msg }, location.origin);
    setTimeout(() => {
      if (waiting.delete(id)) reject(new ExtensionMissing());
    }, timeout);
  });
}

/** Whether the extension is installed and listening in this page.
 *
 * A content script is only injected into pages loaded after the extension was,
 * so a tab left open across the install answers "no" until it is reloaded. */
export async function present() {
  try {
    return !!(await ask({ type: "ping" }, 1500))?.ok;
  } catch {
    return false;
  }
}
