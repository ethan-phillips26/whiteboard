/**
 * Playing a file that is too big to fetch.
 *
 * A handout is small enough to bring down whole and hand to the page as an
 * object URL. A lecture recording is not: it does not fit in one message to the
 * extension, and nobody wants to wait for all of it before the first frame. So a
 * video is never downloaded at all. It is given a URL of this app's own
 * (`stream/<id>`), the service worker answers the <video> element's range
 * requests on it, and this module is what the worker asks — because the worker
 * cannot reach the extension, and this page can.
 *
 * The Blackboard path stays here, in a map, rather than in the URL: the address
 * of a video is not something to write into the DOM, and the id means nothing to
 * anyone who finds it.
 */

import { open } from "./blackboard.js";
import { DEMO } from "./mode.js";

const sources = new Map();
let registered = null;
let listening = false;

/** Whether this browser can stream at all. A page opened from a file:// URL or
 * an old browser has no worker, and the viewer falls back to saying so. */
export function canStream() {
  return whyNoStream() === null;
}

/**
 * Why not, when it cannot — because the two reasons want different words.
 *
 * "This browser can't" is false in the demo, where the browser is fine and it is
 * the made-up data that has no video behind it, and telling a visitor to go and
 * find a better browser over that would be a lie.
 */
export function whyNoStream() {
  if (DEMO) return "demo";
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  return null;
}

/**
 * Put the worker in place. Registered once, on load rather than on the first
 * video: a worker only controls pages that were claimed before they asked, and
 * "press play, then reload, then press play again" is not a feature.
 */
export function registerStreamWorker() {
  if (!canStream()) return Promise.resolve(null);
  registered ??= navigator.serviceWorker
    // Relative to the document, so the same code works at /whiteboard/ on Pages
    // and at / in dev, and the scope is whatever directory the app is served from.
    .register(new URL("sw.js", location.href), { updateViaCache: "none" })
    .catch(() => null); // a site that cannot stream still reads everything else
  listen();
  return registered;
}

function listen() {
  if (listening || !canStream()) return;
  listening = true;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.kind !== "whiteboard:range") return;
    const port = event.ports[0];
    if (!port) return;
    answer(event.data)
      .then((reply) => port.postMessage(reply, [reply.buffer]),
            (e) => {
              // The worker turns this into a 502 whose body says why, which is
              // several clicks deep in a network panel. A player that will not
              // play should say why where someone is already looking.
              console.error("[whiteboard] video stream failed:", e.message);
              port.postMessage({ error: e.message });
            });
  });
}

// What a file is when its server will not say — the same set asFile works from.
const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

async function answer({ id, start, end }) {
  const source = sources.get(id);
  if (!source) throw new Error("That video is no longer open.");
  const bb = await open();
  const slice = await bb.range(source.path, start, end);
  // A real type from the server wins; "octet-stream" is not a real type, and
  // handing it to a <video> is the same as handing it nothing.
  const type = GENERIC_TYPES.has(slice.type) ? (source.type || slice.type) : slice.type;
  // What the server said the first time is kept: a later chunk that omits the
  // total must not make a video that was seekable stop being so.
  if (slice.total != null) source.total = slice.total;
  return {
    buffer: slice.buffer,
    total: slice.total ?? source.total,
    type,
  };
}

/**
 * A URL this app can serve for a file it will never hold.
 *
 * The id is random rather than derived from the path, so nothing about where the
 * video lives is legible in the address bar or in the page's markup.
 */
export function streamUrl(path, { type = "", filename = "" } = {}) {
  const id = crypto.randomUUID();
  sources.set(id, { path, type, filename, total: null });
  return new URL(`stream/${id}`, location.href).toString();
}

const idOf = (url) => String(url ?? "").split("/").pop();

/**
 * Keep a stream that is still on screen.
 *
 * React mounts, cleans up and mounts again in development, and the URL survives
 * that because it is held in state while the mapping behind it does not. Without
 * this the video releases itself the instant it appears, and every range asks
 * for an id no tab has heard of.
 */
export function holdStream(url, path, { type = "", filename = "" } = {}) {
  const id = idOf(url);
  if (id && !sources.has(id)) sources.set(id, { path, type, filename, total: null });
}

/** Forget one stream, when the viewer that was playing it closes. */
export function releaseStream(url) {
  sources.delete(idOf(url));
}
