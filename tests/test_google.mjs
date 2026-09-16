/**
 * What gets sent to Google, and what it becomes.
 *
 * The flow itself needs a browser, a tab and a Google account, so what is
 * checked here is the part that decides: which files are offered at all, what
 * each one is declared to be, what it is named once it is there, and the
 * redirect address — which has to match what is registered in the Cloud console
 * exactly, and is the one string that would silently break the whole feature.
 *
 *   node tests/test_google.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Imported in node, with no window and no location: the components that use
// this module are rendered server-side by test_course_page.mjs, so anything it
// touched at module scope would take that test down with it.
const { appFor, available, docName, offered, redirectUri, sourceType, targetType } =
  await import(join(root, "src/browser/google.js"));

const fails = [];
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}` + (cond ? "" : `  — ${detail}`));
  if (!cond) fails.push(label);
}

const DOC = "application/vnd.google-apps.document";
const SLIDES = "application/vnd.google-apps.presentation";
const SHEET = "application/vnd.google-apps.spreadsheet";

console.log("\n[google] what each handout opens as");
check("Word becomes a Google Doc",
      targetType("essay.docx") === DOC && targetType("old-syllabus.doc") === DOC);
check("PowerPoint becomes Slides",
      targetType("week3.pptx") === SLIDES && targetType("intro.ppt") === SLIDES);
check("Excel and CSV become Sheets",
      targetType("marks.xlsx") === SHEET && targetType("data.csv") === SHEET);
check("OpenDocument is read too",
      targetType("notes.odt") === DOC && targetType("deck.odp") === SLIDES);
check("the button names the Google app it opens",
      appFor("essay.docx") === "Docs" && appFor("week3.pptx") === "Slides"
      && appFor("marks.xlsx") === "Sheets",
      `${appFor("essay.docx")}/${appFor("week3.pptx")}/${appFor("marks.xlsx")}`);

console.log("\n[google] what is deliberately not offered");
// Drive runs OCR on these, which returns a document that looks like the handout
// and is not it. They are exactly what the page's own viewer is for.
check("a PDF is not sent", targetType("reading.pdf") === null && appFor("reading.pdf") === null);
check("an image is not sent", targetType("diagram.png") === null);
check("a file with no extension is not sent", targetType("attachment") === null);
check("an unknown format is not sent", targetType("archive.zip") === null);
check("the extension is read case-insensitively", targetType("ESSAY.DOCX") === DOC);

console.log("\n[google] what the file is declared to be");
// Blackboard often serves a handout as "bytes", and Drive converts by what it
// is told rather than what it finds, so the extension is what decides.
check("Word is declared as Word",
      sourceType("essay.docx").endsWith("wordprocessingml.document"), sourceType("essay.docx"));
check("PowerPoint is declared as PowerPoint",
      sourceType("week3.pptx").endsWith("presentationml.presentation"));
check("a format Google cannot take falls back rather than lying",
      sourceType("archive.zip") === "application/octet-stream");

console.log("\n[google] what it is called once it is there");
check("the extension is dropped from the name", docName("Essay 2.docx") === "Essay 2");
check("only the last one", docName("v1.2.final.docx") === "v1.2.final");
check("a name that is only an extension still gets a name",
      docName(".docx") === ".docx" || docName(".docx").length > 0, docName(".docx"));
check("nothing at all is still something", docName("") === "Untitled" && docName(null) === "Untitled");

console.log("\n[google] the redirect address");
// It must match the Cloud console character for character. It names index.html
// because Vite's dev server answers a bare public/ directory with the app's own
// index.html — `google/` would come back as the dashboard and the relay in it
// would never run.
check("it is built from the page, under it",
      redirectUri("https://ethanphillips.dev/whiteboard/")
      === "https://ethanphillips.dev/whiteboard/google/index.html",
      redirectUri("https://ethanphillips.dev/whiteboard/"));
check("the same address whether or not index.html is spelled out",
      redirectUri("https://ethanphillips.dev/whiteboard/index.html")
      === redirectUri("https://ethanphillips.dev/whiteboard/"));
check("a route in the hash does not change it",
      redirectUri("https://ethanphillips.dev/whiteboard/#/settings/_11_1")
      === "https://ethanphillips.dev/whiteboard/google/index.html",
      redirectUri("https://ethanphillips.dev/whiteboard/#/settings/_11_1"));
check("neither does the demo flag",
      redirectUri("https://ethanphillips.dev/whiteboard/?demo#/grades")
      === "https://ethanphillips.dev/whiteboard/google/index.html");
check("dev gets a dev address", redirectUri("http://localhost:5173/") === "http://localhost:5173/google/index.html");

console.log("\n[google] when Google is offered at all");
// The rule, not this build's copy of it. Whether a client id happens to be
// pasted in is configuration: a check that asserts one fails the moment it is
// filled in, which is exactly what it did.
check("no client id means no Google", offered("", false) === false);
check("a client id turns it on", offered("x.apps.googleusercontent.com", false) === true);
check("but never in the demo", offered("x.apps.googleusercontent.com", true) === false);
check("this build answers one way or the other", typeof available() === "boolean");

console.log("\n" + "=".repeat(60));
console.log(fails.length ? `FAILED (${fails.length}): ${fails.join(", ")}` : "ALL CHECKS PASSED");
console.log("=".repeat(60));
process.exit(fails.length ? 1 : 0);
