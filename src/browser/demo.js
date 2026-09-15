// A fake Blackboard for the demo. It answers the same requests the extension
// does, with made-up data for a made-up NDSU computer science student, so every
// screen runs its real code against it — syncing, grades, materials, files and
// the calendar. Dates are set relative to today, so the demo never goes stale.
// The courses are real NDSU CSCI courses; everything inside them is invented.

import * as E from "./edits.js";
import * as store from "./store.js";

const HOST = "https://blackboard.example.edu";
const USER = { id: "_4201_1", userName: "jordan.rivera",
               name: { given: "Jordan", family: "Rivera" } };

/** A day relative to today, at a local time, in Blackboard's UTC ISO form. */
function at(days, hour = 23, minute = 59) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const MONTH = new Date().getMonth();
const TERM_NAME = `${MONTH < 5 ? "Spring" : MONTH < 7 ? "Summer" : "Fall"} ${new Date().getFullYear()}`;
const TERM = {
  id: "_310_1", name: TERM_NAME,
  availability: { duration: { type: "DateRange", start: at(-35, 0, 0), end: at(80) } },
};

/* ------------------------------------------------------------------ courses */

// Gradebook columns: due is in days from today (null for none); a score means it
// has been graded, and "NeedsGrading" means it is handed in and waiting.
const col = (name, cat, possible, due, more = {}) => ({ name, cat, possible, due, ...more });
const syllabus = (code) => ({ key: "syllabus", kind: "document", title: "Syllabus",
  body: "<p>How this course runs: grading, late work, office hours and the schedule.</p>",
  files: [`CSCI${code}-Syllabus.pdf`] });

const COURSES = [
  {
    id: "_366_1", code: "366", title: "Database Systems",
    categories: { hw: "Homework", quiz: "Quizzes", exam: "Exams", project: "Term Project" },
    columns: [
      col("HW 1: ER Diagrams", "hw", 50, -24, { score: 46 }),
      col("HW 2: Relational Algebra", "hw", 50, -10, { score: 44 }),
      col("HW 3: SQL Queries", "hw", 50, 3, { content: "hw3" }),
      col("HW 4: Normalization", "hw", 50, 17, { content: "hw4" }),
      col("Quiz 1", "quiz", 20, -17, { score: 18 }),
      col("Quiz 2", "quiz", 20, 6),
      col("Midterm Exam", "exam", 100, 12),
      col("Project Proposal", "project", 25, -3, { status: "NeedsGrading", content: "proposal" }),
      col("Final Project", "project", 150, 45, { content: "final" }),
    ],
    content: [
      syllabus("366"),
      { key: "wk1", kind: "folder", title: "Week 1: The Relational Model", children: [
        { key: "slides1", kind: "file", title: "Lecture 1 slides", files: ["366-L01-relational-model.pdf"] },
        { key: "read1", kind: "document", title: "Reading",
          body: "<p>Read chapters 1 and 2 of the textbook before Thursday's class.</p>" },
      ] },
      { key: "wk3", kind: "folder", title: "Week 3: SQL", children: [
        { key: "slides5", kind: "file", title: "Lecture 5 slides", files: ["366-L05-sql-basics.pdf"] },
        { key: "hw3", kind: "assignment", title: "HW 3: SQL Queries",
          body: "<p>Write the twelve queries in the starter file against the company schema " +
                "and submit one <b>.sql</b> file.</p><ul><li>Queries 1-6: single-table SELECT " +
                "with filters and ordering</li><li>Queries 7-12: joins, grouping and " +
                "subqueries</li></ul><p>Test every answer on the lab PostgreSQL server first.</p>",
          files: ["hw3-queries.sql", "company-schema.pdf"] },
      ] },
      { key: "assign", kind: "folder", title: "Assignments", children: [
        { key: "hw4", kind: "assignment", title: "HW 4: Normalization",
          body: "<p>Normalize the three relations in the handout to BCNF and justify each " +
                "decomposition.</p>", files: ["hw4-normalization.pdf"] },
        { key: "proposal", kind: "assignment", title: "Project Proposal",
          body: "<p>One page: your domain, its entities, and five questions your database " +
                "will answer.</p>" },
        { key: "final", kind: "assignment", title: "Final Project",
          body: "<p>A working PostgreSQL database for your proposal, with a schema diagram, " +
                "sample data and the SQL for your five questions.</p>" },
      ] },
      { key: "pgdocs", kind: "externallink", title: "PostgreSQL Documentation",
        url: "https://www.postgresql.org/docs/",
        body: "<p>The reference for every SQL feature we use this term.</p>" },
    ],
    announcements: [
      ["Midterm review session", -1, "<p>Review session Thursday 6-8 PM in the Quentin " +
        "Burdick Building. Bring your questions from HW 1-3.</p>"],
      ["HW 3 clarification", -4, "<p>For query 9, count employees with no dependents as " +
        "zero, not null.</p>"],
    ],
  },
  {
    id: "_374_1", code: "374", title: "Computer Organization and Architecture",
    categories: { lab: "Labs", hw: "Homework", exam: "Exams" },
    columns: [
      col("Lab 1: Data Representation", "lab", 20, -20, { score: 19 }),
      col("Lab 2: MIPS Basics", "lab", 20, -8, { score: 17 }),
      col("Lab 3: Procedures and the Stack", "lab", 20, 4, { content: "lab3" }),
      col("Homework 2: Instruction Encoding", "hw", 30, -5, { score: 27 }),
      col("Homework 3: Single-Cycle Datapath", "hw", 30, 10, { content: "hw3" }),
      col("Midterm Exam", "exam", 100, 19),
    ],
    content: [
      syllabus("374"),
      { key: "labs", kind: "folder", title: "Labs", children: [
        { key: "lab3", kind: "assignment", title: "Lab 3: Procedures and the Stack",
          body: "<p>Write a recursive factorial and a string reverse in MIPS assembly using " +
                "proper stack frames. Run both in MARS and submit your .asm file with a " +
                "screenshot of the register window.</p>", files: ["lab3-starter.asm"] },
      ] },
      { key: "hwk", kind: "folder", title: "Homework", children: [
        { key: "hw3", kind: "assignment", title: "Homework 3: Single-Cycle Datapath",
          body: "<p>Trace the four instructions in the handout through the single-cycle " +
                "datapath and fill in every control signal.</p>", files: ["hw3-datapath.pdf"] },
      ] },
    ],
    announcements: [
      ["Lab moved this week", -2, "<p>This week's lab meets in the Quentin Burdick Building " +
        "computer lab instead of our usual room.</p>"],
    ],
  },
  {
    id: "_313_1", code: "313", title: "Software Development with Frameworks",
    categories: { asg: "Assignments", team: "Team Project", part: "Participation" },
    columns: [
      col("A1: React Components", "asg", 100, -14, { score: 95 }),
      col("A2: State and Hooks", "asg", 100, -2, { status: "NeedsGrading" }),
      col("A3: REST API with Express", "asg", 100, 8, { content: "a3" }),
      col("Sprint 1 Demo", "team", 50, 13),
      col("Sprint 2 Demo", "team", 50, 34),
      col("Participation", "part", 10, null, { score: 9 }),
    ],
    content: [
      syllabus("313"),
      { key: "mod3", kind: "folder", title: "Module 3: Back-End Frameworks", children: [
        { key: "slides", kind: "file", title: "Express routing slides", files: ["313-express-routing.pdf"] },
        { key: "a3", kind: "assignment", title: "A3: REST API with Express",
          body: "<p>Build the task-tracker API described in the spec: five endpoints, input " +
                "validation, and tests for each route.</p>",
          files: ["a3-requirements.md", "api-spec.json"] },
      ] },
      { key: "react", kind: "externallink", title: "React documentation",
        url: "https://react.dev/", body: "<p>Official docs for the front-end half of the course.</p>" },
    ],
    announcements: [
      ["Team assignments posted", -6, "<p>Project teams are posted under Module 3. Meet your " +
        "team before Sprint 1 planning.</p>"],
    ],
  },
  {
    id: "_336_1", code: "336", title: "Theoretical Computer Science",
    categories: { ps: "Problem Sets", exam: "Exams" },
    columns: [
      col("Problem Set 1: Finite Automata", "ps", 40, -18, { score: 38 }),
      col("Problem Set 2: Regular Expressions", "ps", 40, -4, { score: 35 }),
      col("Problem Set 3: Context-Free Grammars", "ps", 40, 9, { content: "ps3" }),
      col("Exam 1", "exam", 100, 22),
    ],
    content: [
      syllabus("336"),
      { key: "notes", kind: "document", title: "Lecture notes: the pumping lemma",
        body: "<p>Notes from Tuesday, with the two worked examples.</p>",
        files: ["336-pumping-lemma.pdf"] },
      { key: "psets", kind: "folder", title: "Problem Sets", children: [
        { key: "ps3", kind: "assignment", title: "Problem Set 3: Context-Free Grammars",
          body: "<p>Six problems on CFGs and pushdown automata. Typeset solutions are " +
                "preferred.</p>", files: ["ps3.pdf"] },
      ] },
    ],
    announcements: [
      ["Office hours moved to Wednesday", -3, "<p>This week only, office hours move to " +
        "Wednesday 1-3 PM.</p>"],
    ],
  },
  {
    id: "_467_1", code: "467", title: "Algorithm Analysis",
    categories: { hw: "Homework", quiz: "Quizzes", exam: "Exams" },
    columns: [
      col("Homework 1: Asymptotic Analysis", "hw", 50, -15, { score: 48 }),
      col("Homework 2: Divide and Conquer", "hw", 50, 2, { content: "hw2" }),
      col("Quiz 1", "quiz", 10, -6, { score: 9 }),
      col("Exam 1", "exam", 100, 26),
    ],
    content: [
      syllabus("467"),
      { key: "hw2", kind: "assignment", title: "Homework 2: Divide and Conquer",
        body: "<p>Solve the four recurrences with the master theorem, then analyse the " +
              "merge sort in the starter file.</p>", files: ["hw2.pdf", "mergesort.py"] },
    ],
    announcements: [
      ["Homework 2 hint", -1, "<p>For problem 3, draw the recursion tree before reaching " +
        "for the master theorem.</p>"],
    ],
  },
];

// Course 366 arrives with its syllabus weighting already entered, so the grades
// screen shows what that looks like; the others are weighted by points.
const SEEDED_WEIGHTS = {
  _366_1: { _366_1_hw: 30, _366_1_quiz: 10, _366_1_exam: 35, _366_1_project: 25 },
};

/* -------------------------------------------------------------------- files */

const TEXT_TYPES = { sql: "text/plain", asm: "text/plain", md: "text/markdown",
                     json: "application/json", py: "text/x-python" };
const mime = (name) => TEXT_TYPES[name.split(".").pop()] ?? "application/pdf";

const FILE_TEXT = {
  "hw3-queries.sql": "-- CSCI 366 HW 3: SQL queries against the company schema\n" +
    "-- Write one query per question. Keep the numbering.\n\n" +
    "-- 1. List every employee's first and last name, ordered by last name.\n\n" +
    "-- 2. Find the employees in department 5 who earn more than 30000.\n\n" +
    "-- 9. For each employee, count their dependents (zero, not null, for none).\n",
  "lab3-starter.asm": "# CSCI 374 Lab 3: procedures and the stack\n" +
    "        .text\n        .globl main\nmain:\n        li   $a0, 5\n" +
    "        jal  factorial\n        # print the result in $v0 here\n" +
    "        li   $v0, 10\n        syscall\n\nfactorial:\n" +
    "        # TODO: push $ra and $a0, recurse, pop, return\n        jr   $ra\n",
  "a3-requirements.md": "# A3: REST API with Express\n\n" +
    "Build a task-tracker API with these endpoints:\n\n" +
    "- GET /tasks\n- POST /tasks\n- GET /tasks/:id\n- PATCH /tasks/:id\n- DELETE /tasks/:id\n\n" +
    "Validate every request body and write a test for each route.\n",
  "api-spec.json": JSON.stringify({ openapi: "3.0.0",
    info: { title: "Task Tracker", version: "1.0.0" },
    paths: { "/tasks": { get: { summary: "List tasks" }, post: { summary: "Create a task" } } },
  }, null, 2) + "\n",
  "mergesort.py": "def merge_sort(items):\n    \"\"\"CSCI 467 HW 2: analyse this.\"\"\"\n" +
    "    if len(items) <= 1:\n        return items\n    mid = len(items) // 2\n" +
    "    left, right = merge_sort(items[:mid]), merge_sort(items[mid:])\n" +
    "    merged = []\n    while left and right:\n" +
    "        merged.append((left if left[0] <= right[0] else right).pop(0))\n" +
    "    return merged + left + right\n",
};

/** A one-page PDF with a heading and some lines of text. ASCII only. */
function makePdf(title, lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = [`BT /F1 18 Tf 72 720 Td (${esc(title)}) Tj ET`,
    ...lines.map((line, i) => `BT /F1 12 Tf 72 ${684 - i * 20} Td (${esc(line)}) Tj ET`),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

function fileBody(name) {
  if (FILE_TEXT[name]) return FILE_TEXT[name];
  const heading = name.replace(/\.pdf$/, "").replace(/[-_]/g, " ");
  const lines = /syllabus/i.test(name)
    ? ["Grading: see the course's gradebook categories.",
       "Late work: 10% off per day, up to three days.",
       "Office hours: Tuesday and Thursday, 2-3 PM.", "",
       "Sample file for the Whiteboard demo. The student and course content are made up."]
    : ["Sample handout for the Whiteboard demo.",
       "The student, the assignments and this file are made up."];
  return makePdf(heading, lines);
}

/* -------------------------------------------------------------------- world */

/** Every course as the REST API would describe it, built once per page load. */
function build() {
  const world = { memberships: [], columns: {}, categories: {}, grades: {}, top: {},
                  items: new Map(), children: new Map(), attachments: new Map(),
                  files: new Map(), announcements: {} };
  const embed = (cid, name) =>
    `<p><a href="${HOST}/bbcswebdav/xid-${cid}/${encodeURIComponent(name)}" ` +
    `data-bbtype="attachment" data-bbfile='${JSON.stringify({ fileName: name, mimeType: mime(name) })}'>` +
    `${name}</a></p>`;

  for (const course of COURSES) {
    const cid = course.id;
    world.memberships.push({ courseId: cid, userId: USER.id, course: {
      id: cid, courseId: `CSCI-${course.code}-01`,
      name: `CSCI ${course.code} ${course.title} - ${TERM_NAME}`,
      termId: TERM.id, availability: { available: "Yes" },
    } });
    world.categories[cid] = Object.entries(course.categories)
      .map(([key, title]) => ({ id: `${cid}_${key}`, title }));

    const columnFor = {};
    world.columns[cid] = course.columns.map((c, i) => {
      const id = `${cid}_col${i + 1}`;
      if (c.content) columnFor[c.content] = id;
      return {
        id, name: c.name, contentId: c.content ? `${cid}_${c.content}` : null,
        gradebookCategoryId: `${cid}_${c.cat}`, score: { possible: c.possible },
        grading: { type: "Attempts", ...(c.due != null ? { due: at(c.due) } : {}) },
      };
    }).concat({ id: `${cid}_total`, name: "Weighted Total", score: { possible: 100 },
                scoreProviderHandle: "resource/x-bb-calculatedgrade",
                grading: { type: "Calculated" } });
    world.grades[cid] = course.columns.flatMap((c, i) => {
      const columnId = `${cid}_col${i + 1}`;
      if (c.score != null) {
        return [{ userId: USER.id, columnId, status: "Graded", score: c.score,
                  displayGrade: { score: c.score } }];
      }
      return c.status ? [{ userId: USER.id, columnId, status: c.status }] : [];
    });

    const walk = (nodes, parentId) => nodes.map((node, i) => {
      const id = `${cid}_${node.key}`;
      const handler = { id: `resource/x-bb-${node.kind}` };
      if (node.url) handler.url = node.url;
      if (node.kind === "file") handler.file = { fileName: node.files[0] };
      if (node.kind === "assignment" && columnFor[node.key]) handler.gradeColumnId = columnFor[node.key];
      // Documents carry their files inline, the way Ultra does; assignments and
      // file items list them as attachments, the classic way.
      const inline = node.kind === "document" ? (node.files ?? []).map((f) => embed(cid, f)).join("") : "";
      world.items.set(id, {
        id, title: node.title, parentId, position: i, contentHandler: handler,
        body: (node.body ?? "") + inline, hasChildren: !!node.children,
        created: at(-40, 9, 0), modified: at(-(i + 2), 10, 0),
      });
      if (node.kind !== "document") {
        world.attachments.set(id, (node.files ?? []).map((name, n) => {
          const aid = `${id}_a${n + 1}`;
          world.files.set(aid, name);
          return { id: aid, fileName: name, mimeType: mime(name) };
        }));
      }
      if (node.children) world.children.set(id, walk(node.children, id));
      return id;
    });
    world.top[cid] = walk(course.content, undefined);

    world.announcements[cid] = course.announcements.map(([title, days, body], i) =>
      ({ id: `${cid}_ann${i + 1}`, title, created: at(days, 9 + i, 15), body }));
  }
  return world;
}

let world = null;

/* ------------------------------------------------------------------ answers */

const ok = (data) => ({ ok: true, status: 200, data });
const results = (list) => ok({ results: list });
const notFound = { error: "http", status: 404 };

function get(path) {
  world ??= build();
  const p = new URL(path, HOST).pathname.replace(/^\/learn\/api\/public/, "");
  let m;
  if (p === "/v1/users/me") return ok(USER);
  if ((m = p.match(/^\/v1\/users\/[^/]+\/courses$/))) return results(world.memberships);
  if ((m = p.match(/^\/v1\/terms\/([^/]+)$/))) return m[1] === TERM.id ? ok(TERM) : notFound;
  if ((m = p.match(/^\/v2\/courses\/([^/]+)\/gradebook\/columns$/))) return results(world.columns[m[1]] ?? []);
  if ((m = p.match(/^\/v1\/courses\/([^/]+)\/gradebook\/categories$/))) return results(world.categories[m[1]] ?? []);
  if ((m = p.match(/^\/v2\/courses\/([^/]+)\/gradebook\/users\/[^/]+$/))) return results(world.grades[m[1]] ?? []);
  if ((m = p.match(/^\/v1\/courses\/([^/]+)\/announcements$/))) return results(world.announcements[m[1]] ?? []);
  const toItems = (ids) => ids.map((id) => world.items.get(id));
  if ((m = p.match(/^\/v1\/courses\/([^/]+)\/contents$/))) return results(toItems(world.top[m[1]] ?? []));
  if ((m = p.match(/^\/v1\/courses\/[^/]+\/contents\/([^/]+)\/children$/))) {
    return results(toItems(world.children.get(m[1]) ?? []));
  }
  if ((m = p.match(/^\/v1\/courses\/[^/]+\/contents\/([^/]+)\/attachments$/))) {
    return results(world.attachments.get(m[1]) ?? []);
  }
  if ((m = p.match(/^\/v1\/courses\/[^/]+\/contents\/([^/]+)$/))) {
    return world.items.has(m[1]) ? ok(world.items.get(m[1])) : notFound;
  }
  return notFound;
}

function file(path) {
  world ??= build();
  const url = new URL(path, HOST);
  const attachment = url.pathname.match(/\/attachments\/([^/]+)\/download$/);
  const name = attachment ? world.files.get(attachment[1])
    : url.pathname.startsWith("/bbcswebdav/")
      ? decodeURIComponent(url.pathname.split("/").pop()) : null;
  if (!name) return notFound;
  const body = fileBody(name);
  return { ok: true, status: 200, type: mime(name),
           disposition: `attachment; filename="${name}"`,
           bytes: body.length, base64: btoa(body) };
}

let seeded = false;

async function seed() {
  if (seeded) return;
  seeded = true;
  if (await store.read("demo_seeded")) return;
  for (const [courseId, weights] of Object.entries(SEEDED_WEIGHTS)) {
    await E.setWeights(courseId, weights);
  }
  await store.write("demo_seeded", true);
}

/** The demo's answer to anything the page would ask the extension. */
export async function answer(msg) {
  switch (msg?.type) {
    case "ping": return { ok: true, version: "demo" };
    case "status":
    case "connect":
    case "signin":
      await seed();
      return { state: "signed-in", host: HOST, user: USER };
    case "host": return { host: HOST };
    case "disconnect": return { ok: true };
    case "get": return get(String(msg.path ?? ""));
    case "file": return file(String(msg.path ?? ""));
    default: return { error: "unknown", message: `No such request: ${msg?.type}` };
  }
}
