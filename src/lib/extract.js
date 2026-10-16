/**
 * The words inside a handout, without drawing it.
 *
 * The reader already yields text as a side effect of rendering a document, but
 * that only covers what has been opened. Indexing a term's worth of files cannot
 * render a term's worth of documents, so this reads the formats open enough to
 * read directly: Word and PowerPoint are zip archives of XML, and a text file is
 * already the text.
 *
 * A PDF is read with pdf.js, which draws nothing here: it is asked only for the
 * text layer. It is loaded on the first PDF, like jszip, so it stays out of the
 * main bundle. A PDF that is only a scan has no text layer to ask for and comes
 * back empty — reading those would be OCR, which this is not.
 *
 * jszip is loaded only when there is an archive to open, so it stays out of the
 * main bundle like the renderers do.
 */

import { kindOf } from "./viewer.js";

// What can actually be read here. Everything else is indexed by name alone.
export const READABLE = ["text", "docx", "pptx", "pdf"];

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

// A PDF of a whole textbook is not worth the time it takes; what is read is the first
// part, and the reader can still open the rest.
const MAX_PDF_PAGES = 300;

/** Between pages of a PDF's text. A form feed is what plain text uses for a page
 * break, and it collapses to a space wherever whitespace is collapsed. */
export const PAGE_BREAK = "\f";

/** Whitespace collapsed inside each page, with the page breaks kept — so a stored
 * extract still knows where one page ends and the next begins. Blank pages stay: the
 * number of a page is its place in the file, and dropping one would shift the rest. */
export function squashPages(text) {
  return String(text ?? "").split(PAGE_BREAK).map((p) => p.replace(/\s+/g, " ").trim()).join(PAGE_BREAK);
}

/** The words of a PDF with each page headed `[page N]`, so what is read can be placed. */
export function markPages(words) {
  return String(words ?? "").split(PAGE_BREAK).map((p, i) => `[page ${i + 1}]\n${p}`).join("\n\n");
}

/** Which pages `[from, end)` of marked text covers, as `[first, last]`. */
export function pagesCovered(marked, from, end) {
  const marks = [...marked.matchAll(/\[page (\d+)\]/g)];
  const at = (pos) => {
    let page = 1;
    for (const m of marks) {
      if (m.index <= pos) page = Number(m[1]);
      else break;
    }
    return page;
  };
  return [at(from), at(Math.max(from, end - 1))];
}

/** The page of a PDF's words that holds the most of the terms — the first such page
 * when several tie; null for text that has no pages, or terms that are nowhere. One
 * stray word ("week") on an early page must not beat the page that has the rest. */
export function pageWith(words, queryTerms) {
  const pages = String(words ?? "").split(PAGE_BREAK);
  if (pages.length < 2 || !queryTerms?.length) return null;
  const counts = pages.map((p) => {
    const lower = p.toLowerCase();
    return queryTerms.filter((t) => lower.includes(t)).length;
  });
  const best = Math.max(...counts);
  return best > 0 ? counts.indexOf(best) + 1 : null;
}

/** "3", "2-4", "2–4, 9" → the page numbers asked for, in order, within `max`. */
export function parsePages(spec, max = Infinity) {
  const out = new Set();
  for (const part of String(spec ?? "").split(/[,;]/)) {
    const m = part.trim().match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.min(Math.max(a, b), max) && out.size < 200; n++) {
      if (n >= 1) out.add(n);
    }
  }
  return [...out];
}

// The legacy build, not the default one: the default assumes Promise.try and its
// kin, which Node 22 (what CI runs) and older Safari
// do not have. The legacy build brings its own.
//
// The worker is a file the bundler serves, so it is named by URL — in the browser.
// Node (the tests) finds the worker beside the library on its own.
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  }
  return pdfjs;
}

async function pdfText(buffer) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // A line is what pdf.js marks as ending one; runs inside it are joined by a space.
      pages.push(content.items.map((i) => i.str + (i.hasEOL ? "\n" : " ")).join("")
        .replace(/[ \t]+\n/g, "\n").trim());
      page.cleanup();
    }
    return pages.join(PAGE_BREAK);
  } finally {
    await task.destroy();
  }
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
    case "pdf":
      return pdfText(await blob.arrayBuffer());
    default:
      return "";
  }
}
