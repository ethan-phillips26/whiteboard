/**
 * What a handout is, and how it can be shown.
 *
 * Everything is read in the browser. Nothing is converted on the machine serving
 * the app, because that machine is not always this machine and is not always
 * going to have an office suite on it: a PDF, a picture, a video and a text file
 * are things the browser already draws, and Word and PowerPoint are drawn by
 * renderers loaded only for the files that need them.
 *
 * This file only decides which of those a name is, and says why when it is none.
 */

const KINDS = {
  pdf: ["pdf"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "heic"],
  video: ["mp4", "webm", "m4v", "ogv", "mov"],
  audio: ["mp3", "wav", "m4a", "ogg", "oga", "flac"],
  docx: ["docx"],
  pptx: ["pptx"],
  text: ["txt", "md", "markdown", "csv", "tsv", "json", "log", "yml", "yaml",
         "py", "js", "jsx", "ts", "tsx", "java", "c", "h", "cpp", "cs", "go",
         "rs", "rb", "php", "sh", "sql", "r", "m", "css", "html", "htm", "xml"],
};

const BY_EXTENSION = Object.fromEntries(
  Object.entries(KINDS).flatMap(([kind, exts]) => exts.map((e) => [e, kind]))
);

/** The extension, lowercased, or "" for a name that has none. */
export function suffix(filename) {
  const dot = (filename ?? "").lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/** How this file can be shown, or "none" if it can only be downloaded. */
export function kindOf(filename) {
  return BY_EXTENSION[suffix(filename)] ?? "none";
}

export const canView = (filename) => kindOf(filename) !== "none";

/** What to say when a file cannot be drawn — the format, not a shrug. */
export function whyNot(filename) {
  const ext = suffix(filename);
  const legacy = { doc: "Word", ppt: "PowerPoint", xls: "Excel" }[ext];
  if (legacy) {
    return `.${ext} is ${legacy}'s pre-2007 binary format, which browsers cannot ` +
      `read. Download it to open it.`;
  }
  return ext
    ? `.${ext} files cannot be shown in a browser.`
    : "This file has no extension, so there is no telling how to show it.";
}
