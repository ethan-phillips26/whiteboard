/**
 * The words inside a handout, without drawing it.
 *
 * The reader already yields text as a side effect of rendering a document, but
 * that only covers what has been opened. Indexing a term's worth of files cannot
 * render a term's worth of documents, so this reads the formats open enough to
 * read directly: Word and PowerPoint are zip archives of XML, and a text file is
 * already the text.
 *
 * It deliberately does not cover PDF. Nothing in the page can read one — the
 * viewer hands a PDF to the browser's own plugin — and pulling in a PDF engine
 * to index one is a dependency this app does not have. A PDF is still found by
 * its name, which is how most of them are remembered anyway.
 *
 * jszip is loaded only when there is an archive to open, so it stays out of the
 * main bundle like the renderers do.
 */

import { kindOf } from "./viewer.js";

// What can actually be read here. Everything else is indexed by name alone.
export const READABLE = ["text", "docx", "pptx"];

export const indexable = (filename) => READABLE.includes(kindOf(filename));

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decode = (s) => s
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITIES[name])
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));

async function unzip(buffer) {
  const { default: JSZip } = await import("jszip");
  return JSZip.loadAsync(buffer);
}

// Word keeps the text in runs and the paragraphs around them; reading only the
// runs leaves out where one paragraph ended and the next began, which is the
// difference between prose and one long word.
const DOCX_RUN = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<\/w:p>/g;

async function docxText(buffer) {
  const zip = await unzip(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  let out = "";
  for (const m of xml.matchAll(DOCX_RUN)) out += m[1] === undefined ? "\n" : decode(m[1]);
  return out;
}

const PPTX_RUN = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
// slide2.xml sorts before slide10.xml only if the number is read as a number.
const slideNumber = (name) => Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);

async function pptxText(buffer) {
  const zip = await unzip(buffer);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const out = [];
  for (const name of slides) {
    const xml = await zip.file(name).async("string");
    const words = [...xml.matchAll(PPTX_RUN)].map((m) => decode(m[1]));
    if (words.length) out.push(words.join(" "));
  }
  return out.join("\n");
}

/** What this file says, or "" for one that cannot be read here. */
export async function extractText(filename, blob) {
  switch (kindOf(filename)) {
    case "text":
      return blob.text();
    case "docx":
      return docxText(await blob.arrayBuffer());
    case "pptx":
      return pptxText(await blob.arrayBuffer());
    default:
      return "";
  }
}
