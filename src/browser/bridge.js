// The page's only way to Blackboard: the Whiteboard Connector extension,
// reached through the content script it puts in this page (extension/bridge.js).
// A web page cannot read another site's data, so every request is the extension's;
// this page only asks, and renders what comes back.

import { DEMO, NATIVE } from "./mode.js";

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

// In the app the plugin is imported when first asked, so the site's bundle carries
// none of Capacitor. The reply crosses as a JSON string, exactly as it was sent.
let plugin = null;

async function askNative(msg) {
  plugin ??= import("@capacitor/core").then(({ registerPlugin }) => registerPlugin("Blackboard"));
  let reply;
  try {
    ({ reply } = await (await plugin).ask(msg));
  } catch {
    // A build without the plugin registered is the app's "no extension".
    throw new ExtensionMissing();
  }
  return JSON.parse(reply);
}

/** One request to the extension. Its reply is data, never thrown. */
export function ask(msg, timeout = 60000) {
  // The demo is answered in the page by a fake Blackboard, loaded only when used.
  if (DEMO) return import("./demo.js").then((demo) => demo.answer(msg));
  if (NATIVE) return askNative(msg);
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
