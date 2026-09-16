/**
 * The ranking behind the search palette.
 *
 * Spotlight-style search is judged on its first row, so what is tested here is
 * the *order*, not merely that a match was found: a title beating a body, a word
 * start beating a word middle, and every term having to land somewhere.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractText, indexable } from "../src/lib/extract.js";
import { matchTerm, rank, scoreRecord, snippet, terms }
  from "../src/lib/rank.js";

const fails = [];
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}` + (cond ? "" : `  — ${detail}`));
  if (!cond) fails.push(label);
}

const titles = (results) => results.map((r) => r.record.title);

// --- terms -------------------------------------------------------------------

console.log("\n[search] what was typed");
check("a query splits on anything that is not a letter or a digit",
      JSON.stringify(terms("CS2400_HW3-final")) === '["cs2400","hw3","final"]',
      JSON.stringify(terms("CS2400_HW3-final")));
check("an empty query has no terms", terms("   ").length === 0);
check("accented words survive", JSON.stringify(terms("résumé")) === '["résumé"]');

// --- one term against one field ----------------------------------------------

console.log("\n[search] where the word landed");
const band = (text, term, opts) => matchTerm(text, term, opts)?.score ?? null;

check("an exact name scores highest", band("Quiz 3", "quiz 3") === 1000);
check("a prefix beats a word start",
      band("Quiz 3 review", "quiz") > band("Final Quiz", "quiz"));
check("a word start beats a word middle",
      band("Final Quiz", "quiz") > band("Prequiz notes", "quiz"));
check("matching is case insensitive", band("LECTURE 4", "lecture") > 0);
check("a word that is not there does not match", band("Syllabus", "quiz") === null);

check("an abbreviation matches a title when fuzzy is allowed",
      band("Lecture 4 slides", "l4s", { fuzzy: true }) > 0);
check("and never matches a body, where it would match everything",
      band("Lecture 4 slides", "l4s") === null);
check("letters close together beat the same letters scattered",
      band("l4s handout", "l4s", { fuzzy: true }) >
        band("long 4th section", "l4s", { fuzzy: true }));
check("a subsequence that is not in order does not match",
      band("Lecture 4 slides", "s4l", { fuzzy: true }) === null);

// --- a whole record ----------------------------------------------------------

console.log("\n[search] a record as a whole");
const NOTES = {
  kind: "material", title: "Week 4 notes", course: "CSCI 450",
  body: "The quiz covers hashing.", files: ["notes.pdf"],
};

check("every term has to land somewhere",
      scoreRecord(NOTES, ["quiz", "hashing"]) !== null &&
      scoreRecord(NOTES, ["quiz", "kafka"]) === null);
check("a term may land on the file name",
      scoreRecord(NOTES, ["notes.pdf"]) !== null);

// --- the ordering that matters -----------------------------------------------

console.log("\n[search] the order of the answers");
const CORPUS = [
  { id: "a", kind: "material", title: "Reading list", course: "CSCI 450",
    body: "Start with the quiz 3 study guide." },
  { id: "b", kind: "assignment", title: "Quiz 3", course: "CSCI 450", boost: 24 },
  { id: "c", kind: "material", title: "Practice quiz", course: "CSCI 450" },
  { id: "d", kind: "file", title: "quiz3-answers.pdf", course: "CSCI 450", boost: 4 },
];

const quiz = rank(CORPUS, "quiz");
check("the assignment called Quiz 3 leads", titles(quiz)[0] === "Quiz 3",
      JSON.stringify(titles(quiz)));
check("a title match outranks a body mention",
      titles(quiz).indexOf("Practice quiz") < titles(quiz).indexOf("Reading list"),
      JSON.stringify(titles(quiz)));
check("everything that matches is returned", quiz.length === 4);

const both = rank(CORPUS, "quiz 3");
check("two terms narrow rather than widen",
      both.length === 3 && !titles(both).includes("Practice quiz"),
      JSON.stringify(titles(both)));

check("an empty query returns nothing at all", rank(CORPUS, "  ").length === 0);
check("the limit is honoured", rank(CORPUS, "quiz", { limit: 2 }).length === 2);

// --- snippets ----------------------------------------------------------------

console.log("\n[search] the line shown under a hit");
const long = {
  kind: "file", title: "lecture.pdf",
  text: "x".repeat(300) + " the hashing lemma is proved here " + "y".repeat(300),
};
const hit = rank([long], "hashing")[0];
check("a body hit is shown with the words around it",
      hit.snippet.includes("hashing"), hit.snippet);
check("and is cut down to a line",
      hit.snippet.length < 160, String(hit.snippet.length));
check("a title hit gets no snippet",
      rank([{ kind: "course", title: "CSCI 450" }], "csci")[0].snippet === "");
check("whitespace in a snippet is flattened",
      !snippet({ body: "a\n\nquiz\there" },
               [{ field: "body", at: 0, text: "a\n\nquiz\there" }]).includes("\n"));

// --- what a course's tree becomes --------------------------------------------

// Bundled the way test_course_page.mjs does it, with React left external so the
// bundle and this file share one copy of it.
const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
const req = createRequire(join(FRONTEND, "package.json"));
const { build } = req("esbuild");
const { renderToStaticMarkup } = req("react-dom/server");
const { createElement: h } = req("react");

const outDir = join(FRONTEND, "node_modules", ".cache");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, "search-test-bundle.mjs");
await build({
  stdin: {
    contents: `
      export { default as Spotlight } from "./components/Spotlight.jsx";
      export { default as Welcome } from "./components/Welcome.jsx";
      export { treeRecords } from "./browser/search.js";
    `,
    resolveDir: join(FRONTEND, "src"),
    loader: "jsx",
  },
  outfile: out,
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  logLevel: "silent",
  external: ["react", "react-dom", "react/jsx-runtime"],
});
const { Spotlight, Welcome, treeRecords } = await import(pathToFileURL(out).href);

const COURSE = { course_id: "_11_1", label: "CSCI 450" };
const NODES = [
  { content_id: "_f1", title: "Week 4", is_folder: true, children: [
    { content_id: "_i1", title: "Lecture 4", type: "document", is_folder: false,
      is_assignment: false, body: "Hashing, and why it is fast.",
      files: [{ filename: "l4-slides.pptx" }], children: [] },
    { content_id: "_i2", title: "Quiz 3", type: "assignment", is_folder: false,
      is_assignment: true, grade_column_id: "_c1", body: "", files: [], children: [] },
  ] },
];

console.log("\n[search] a course's tree, flattened");
const flat = treeRecords(NODES, COURSE);
const titled = (kind) => flat.filter((r) => r.kind === kind).map((r) => r.title);

check("a folder is not a destination of its own",
      !flat.some((r) => r.title === "Week 4"), JSON.stringify(titled("material")));
check("what is inside it is",
      JSON.stringify(titled("material")) === '["Lecture 4","Quiz 3"]',
      JSON.stringify(titled("material")));
check("an item remembers the folder it came from",
      flat.find((r) => r.title === "Lecture 4").subtitle === "Week 4");
check("every file is a row of its own",
      JSON.stringify(titled("file")) === '["l4-slides.pptx"]');
check("a file says which item it hangs off",
      flat.find((r) => r.kind === "file").subtitle === "Week 4 › Lecture 4");
check("an item with handouts can be opened",
      flat.find((r) => r.title === "Lecture 4").openable === true);
check("and so can an assignment with none",
      flat.find((r) => r.title === "Quiz 3").openable === true);

// The key is the one written by the reader once it has drawn the file, so this
// is what catches the two drifting apart.
const extract = new Map([["filetext__11_1__i1_l4-slides.pptx", "collision resolution"]]);
const withText = treeRecords(NODES, COURSE, extract);
check("text read from a file earlier is attached to it",
      withText.find((r) => r.kind === "file").text === "collision resolution");
check("and is searchable",
      rank(withText, "collision").length === 1);

// --- the palette itself ------------------------------------------------------

console.log("\n[search] the palette");
const palette = renderToStaticMarkup(h(Spotlight, {
  data: { courses: [], assignments: [], announcements: [] },
  order: [],
  commands: [{ id: "sync", title: "Sync now", subtitle: "Re-read Blackboard",
               run: () => {} }],
  onOpenAssignment: () => {},
  onClose: () => {},
}));
check("it opens on something rather than an empty box",
      palette.includes("Jump to") && palette.includes("Sync now"), palette.slice(0, 300));
check("the field says what it searches",
      palette.includes("Search assignments"));
check("and the keys are on screen",
      palette.includes("esc") && palette.includes("open"));

// --- reading a document without drawing it -----------------------------------

// Real archives, built here: a .docx and a .pptx are zips of XML, and the whole
// point of the extractor is that it reads the actual shape Office writes.
const JSZip = req("jszip");

const docx = async (xml) => {
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  return new Blob([await zip.generateAsync({ type: "uint8array" })]);
};
const pptx = async (slides) => {
  const zip = new JSZip();
  for (const [n, xml] of Object.entries(slides)) zip.file(`ppt/slides/slide${n}.xml`, xml);
  return new Blob([await zip.generateAsync({ type: "uint8array" })]);
};

console.log("\n[search] what a document says");
check("a text file is its own text",
      (await extractText("notes.md", new Blob(["# Hashing"]))) === "# Hashing");

const word = await extractText("essay.docx", await docx(
  `<w:document><w:body>
     <w:p><w:r><w:t>Chapter one.</w:t></w:r></w:p>
     <w:p><w:r><w:t xml:space="preserve">Caf&#233; &amp; more</w:t></w:r></w:p>
   </w:body></w:document>`));
check("Word text comes out of the runs", word.includes("Chapter one."), word);
check("and entities are decoded", word.includes("Café & more"), word);
check("and paragraphs stay apart",
      word.split("\n").filter((l) => l.trim()).length === 2, JSON.stringify(word));

const deck = await extractText("week4.pptx", await pptx({
  1: "<p:sld><a:t>Title slide</a:t></p:sld>",
  2: "<p:sld><a:t>Hashing</a:t><a:t>collisions</a:t></p:sld>",
  10: "<p:sld><a:t>The last slide</a:t></p:sld>",
}));
check("every slide is read",
      deck.includes("Title slide") && deck.includes("collisions") &&
      deck.includes("The last slide"), deck);
check("slide 10 comes after slide 2, not after slide 1",
      deck.indexOf("Hashing") < deck.indexOf("The last slide"), deck);
check("runs on one slide are kept apart",
      deck.includes("Hashing collisions"), deck);

console.log("\n[search] what cannot be read here");
check("a PDF is not offered to the extractor", indexable("reading.pdf") === false);
check("and reading one yields nothing rather than throwing",
      (await extractText("reading.pdf", new Blob(["%PDF-1.7"]))) === "");
check("a video is never read", indexable("lecture.mp4") === false);
check("Word, PowerPoint and text are",
      indexable("a.docx") && indexable("b.pptx") && indexable("c.txt") &&
      indexable("d.csv"));

console.log("\n[search] the welcome");
const welcome = renderToStaticMarkup(h(Welcome, {
  courses: [{ course_id: "_11_1", label: "CSCI 450" }],
  onClose: () => {},
}));
check("it says what the app is", welcome.includes("Welcome to Whiteboard"));
check("and that nothing here writes to Blackboard",
      welcome.includes("only ever reads"), welcome.slice(0, 400));
check("and where the search is", welcome.includes("Ctrl-K"));
check("and carries the indexer",
      welcome.includes("Make documents searchable") &&
      welcome.includes("document"), welcome.slice(-600));
check("and says it can be done later", welcome.includes("later from Settings"));

console.log(fails.length ? `\n${fails.length} failed\n` : "\nall passed\n");
process.exit(fails.length ? 1 : 0);
