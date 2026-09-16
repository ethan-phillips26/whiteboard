/**
 * Documents in the iPhone app, shown by iOS rather than drawn in the page.
 *
 * The page draws Word at its printed width and a PDF in a frame, and the app does
 * not zoom — zooming is off so that a text box cannot leave the page wider than the
 * screen — so on a phone those came out too big to read, with no way to pull back.
 * Quick Look fits the page to the screen and pinches both ways, so the reader hands
 * these kinds over to it (BlackboardPlugin.swift) instead. The site keeps its own
 * reader: a desktop browser draws these well, and zooms.
 */

import { askNative } from "./bridge.js";
import { NATIVE } from "./mode.js";
import { extractText } from "../lib/extract.js";

const KINDS = new Set(["pdf", "docx", "pptx"]);

// The preview's answer is its closing, which is whenever the student is done
// reading — so the bridge's usual minute is no limit to hold it to.
const READING = 24 * 60 * 60 * 1000;

/** Whether this file, here, is shown by iOS. */
export const previewsNatively = (kind) => NATIVE && KINDS.has(kind);

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Open the file in Quick Look; resolves once it has been closed.
 *
 * The words come out first. The page's own reader records what a document says as
 * it draws it, and that is what makes a document searchable after one read; Quick
 * Look draws outside the page, so the text is taken the way the indexer takes it.
 * A PDF has no reader in the page either way, and stays findable by name.
 */
export async function previewNatively(source, filename, { onText } = {}) {
  const res = await fetch(source);
  if (!res.ok) throw new Error(`The file could not be read (${res.status}).`);
  const blob = await res.blob();
  if (onText) {
    extractText(filename, blob).then((text) => text && onText(text), () => {});
  }
  // Past the demo's fake Blackboard: showing a file is the phone's job either way.
  const reply = await askNative(
    { type: "preview", filename, base64: toBase64(await blob.arrayBuffer()) }, READING);
  if (reply?.error) throw new Error(reply.message || reply.error);
}
