// The tools Claude is given in the Claude tab. They are the page's, not a server's:
// each answers from what the page already holds or fetches through the extension, so
// the Blackboard session in use is the one the student is signed in with here, and
// the read-only rule is the extension's, unchanged. Claude never sees a cookie.
//
// The host passes each call up and the answer back (claude-bridge/host.mjs); it
// knows none of this.

import { PAGE_BREAK, extractText, indexable, markPages, pageWith, pagesCovered, parsePages } from "../lib/extract.js";
import { rank, terms } from "../lib/rank.js";
import { QuizError, normalizeQuiz } from "../lib/quiz.js";
import { api } from "../api.js";
import * as library from "./library.js";
import * as search from "./search.js";
import * as store from "./store.js";
import * as sync from "./sync.js";

// A reply is read by a model, so it is cut well before it would crowd out the
// conversation; the tool says it was cut so Claude can ask for less.
const MAX_REPLY = 24000;
const MAX_FILE_TEXT = 40000;
const MAX_ROWS = 300;
// Reading a term of documents is slow, so one search spends at most this long at it and
// says what is left. The host gives a tool three minutes.
const READ_BUDGET_MS = 90000;
const HITS = 12;

const course = { type: "string", description: "A course_id from list_courses." };

export const DEFINITIONS = [
  {
    name: "list_courses",
    description: "The student's current courses: course_id, short label and full title.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_due_dates",
    description: "Assignments that are due or overdue and not yet handed in, soonest first, " +
      "including work the student added themselves. Each has course_id and, for Blackboard " +
      "work, a content_id that get_assignment needs.",
    inputSchema: { type: "object", properties: {
      course_id: course,
      include_submitted: { type: "boolean", description: "Also list work already handed in." },
    } },
  },
  {
    name: "get_assignment",
    description: "The instructions, due date and attachment names for one assignment.",
    inputSchema: { type: "object", properties: { course_id: course,
      content_id: { type: "string", description: "From list_due_dates or browse_course_content." } },
      required: ["course_id", "content_id"] },
  },
  {
    name: "browse_course_content",
    description: "The course's content tree (folders, documents, assignments, links) as an " +
      "indented outline with ids. Optionally only the items whose title or text contains `query`.",
    inputSchema: { type: "object", properties: { course_id: course,
      query: { type: "string" } }, required: ["course_id"] },
  },
  {
    name: "search_course_material",
    description: "Search everything the student's courses hold — assignments, announcements, " +
      "pages, file names and the words inside documents already read — the same index as the " +
      "app's search box. START HERE for any question about what the course material says. It " +
      "reports what it could not search yet (courses never opened, documents not read); when " +
      "results are thin it reads those documents itself, and `read_unread: true` forces that. " +
      "Results give ids for read_course_item, and for a PDF the `page` the match is on: read just " +
      "that page with read_course_item's `pages`.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Words to find, e.g. \"hash collision chaining\"." },
      course_id: course,
      read_unread: { type: "boolean", description: "Read every document not yet read (in " +
        "course_id, or all courses) before searching. Slow; stops after about 90 seconds and " +
        "says how many remain." },
    }, required: ["query"] },
  },
  {
    name: "read_course_item",
    description: "One content item's page text and the files attached to it. Pass `file` (a " +
      "filename from the attachments) to read that file's text: Word, PowerPoint, PDF and text " +
      "files can be read (a scanned PDF has no text to read; videos cannot be). A PDF is read by " +
      "page: pass `pages` (\"14\" or \"12-15\") to read just those, which also makes the source link " +
      "open at them. Otherwise long files come in parts: pass `start` to continue.",
    inputSchema: { type: "object", properties: { course_id: course,
      content_id: { type: "string" }, file: { type: "string" },
      pages: { type: "string", description: "PDF pages to read, e.g. \"14\" or \"12-15\"." },
      start: { type: "integer", description: "Character offset to continue a long file from." } },
      required: ["course_id", "content_id"] },
  },
  {
    name: "list_announcements",
    description: "Recent announcements, newest first, with their text.",
    inputSchema: { type: "object", properties: { course_id: course,
      limit: { type: "integer", description: "Default 10." } } },
  },
  {
    name: "get_grades",
    description: "The current and projected grade for one course, or every course, with the " +
      "category breakdown. Weights are the student's own where they entered them.",
    inputSchema: { type: "object", properties: { course_id: course } },
  },
  {
    name: "create_document",
    description: "Show the student a document you wrote — a study guide, summary, outline, " +
      "worked solutions. Markdown: headings, lists, tables, code, bold/italic. It opens beside " +
      "the chat and is saved to their library. Do not repeat its contents in chat.",
    inputSchema: { type: "object", properties: {
      title: { type: "string" }, markdown: { type: "string" }, course_id: course },
      required: ["title", "markdown"] },
  },
  {
    name: "create_quiz",
    description: "Give the student an interactive practice quiz. Choice, true/false, numeric " +
      "and fill-in questions are checked instantly against your key; short_answer questions " +
      "are graded by a model against your reference. Write each question to be answerable " +
      "from the course material, and give an explanation for every one. Mix types sensibly.",
    inputSchema: { type: "object", properties: {
      title: { type: "string" }, course_id: course,
      questions: { type: "array", items: { type: "object", properties: {
        type: { type: "string", enum: ["multiple_choice", "multi_select", "true_false",
          "numeric", "fill_blank", "short_answer"] },
        prompt: { type: "string", description: "fill_blank prompts must contain ___ for the blank." },
        choices: { type: "array", items: { type: "string" },
          description: "For multiple_choice and multi_select." },
        answer: { description: "multiple_choice: index of the correct choice (from 0). " +
          "multi_select: list of correct indexes. true_false: boolean. numeric: number. " +
          "fill_blank: accepted string or list of accepted strings. Omit for short_answer." },
        tolerance: { type: "number", description: "numeric: allowed absolute error." },
        unit: { type: "string" },
        reference: { type: "string", description: "short_answer: a model answer." },
        rubric: { type: "string", description: "short_answer: what a full-credit answer must cover." },
        explanation: { type: "string", description: "Shown after the student answers." },
      }, required: ["type", "prompt"] } } },
      required: ["title", "questions"] },
  },
];

/** Cut text to what a reply may hold, and say so. */
export function clip(text, max = MAX_REPLY) {
  const s = typeof text === "string" ? text : JSON.stringify(text, null, 1);
  return s.length <= max ? s : `${s.slice(0, max)}\n… [cut: ${s.length - max} more characters; ask for less]`;
}

/** An answer a tool could not give, as Claude should read it. */
class ToolError extends Error {}

const need = (args, ...names) => {
  for (const n of names) {
    if (typeof args[n] !== "string" || !args[n].trim()) throw new ToolError(`"${n}" is required.`);
  }
};

const courseLabel = async (id) =>
  ((await store.getData("courses")) ?? []).find((c) => c.course_id === id)?.label ?? null;

const row = (a) => ({
  title: a.title, course: a.course, course_id: a.course_id, content_id: a.content_id,
  ...(a.own ? { added_by_student: true } : {}),
  due: a.due_local ?? a.due_utc, days_until: a.days_until, points: a.points_possible,
  ...(a.submitted ? { handed_in: true, score: a.score ?? null } : {}),
});

const handlers = {
  async list_courses() {
    const courses = (await store.getData("courses")) ?? [];
    return courses.map((c) => ({ course_id: c.course_id, label: c.label, title: c.title, term: c.term }));
  },

  async list_due_dates({ course_id, include_submitted }, ctx) {
    const state = await api.state(false);
    let items = state.assignments;
    if (include_submitted) {
      const all = (await store.getData("assignments"))?.items ?? [];
      items = [...items, ...all.filter((a) => a.submitted)]
        .sort((a, b) => String(a.due_utc).localeCompare(String(b.due_utc)));
    }
    ctx.cite({ kind: "deadlines", title: "Deadlines", href: "#/" });
    return items.filter((a) => !course_id || a.course_id === course_id).map(row);
  },

  async get_assignment(args, ctx) {
    need(args, "course_id", "content_id");
    const a = await sync.assignment(args.course_id, args.content_id);
    ctx.cite({ kind: "assignment", title: a.title, course: await courseLabel(args.course_id),
               courseId: args.course_id, contentId: args.content_id, href: a.web_url ?? null });
    return {
      title: a.title, type: a.type, instructions: a.instructions, created: a.created,
      modified: a.modified, attachments: (a.attachments ?? []).map((f) => f.filename).filter(Boolean),
    };
  },

  async search_course_material({ query, course_id, read_unread }, ctx) {
    need({ query }, "query");
    const state = await api.state(false);
    const courses = course_id ? state.courses.filter((c) => c.course_id === course_id) : state.courses;
    if (!courses.length) throw new ToolError("No such course. Use a course_id from list_courses.");
    const built = () => search.corpus({
      courses, assignments: state.assignments, announcements: state.announcements,
    });
    const did = [];

    // 1. A course nobody has opened has no content to search. Open them now.
    let { records, unread } = await built();
    if (unread.length) {
      ctx.status(`Opening ${unread.length} course${unread.length === 1 ? "" : "s"} not yet looked at`);
      await search.warm(unread);
      did.push(`Opened ${unread.length} course${unread.length === 1 ? "" : "s"} that had not been looked at yet.`);
      ({ records, unread } = await built());
    }

    // 2. A document whose words were never read can only be found by its name. Read
    //    them when asked to, or when what is already known does not answer.
    let hits = rank(records, query, { limit: HITS });
    const waiting = () => search.pending(courses);
    let left = await waiting();
    if (left.files.length && (read_unread || hits.length < 3)) {
      const deadline = Date.now() + READ_BUDGET_MS;
      const done = await search.indexFiles(courses, {
        shouldStop: () => Date.now() > deadline || ctx.cancelled(),
        onProgress: (p) => p.filename && ctx.status(`Reading ${p.filename} (${p.done}/${p.total})`),
      });
      did.push(`Read ${done.indexed} document${done.indexed === 1 ? "" : "s"} that had not been read yet` +
        (done.failed ? `, ${done.failed} could not be read` : "") +
        (done.stopped ? "; stopped at the time limit, so call again to read the rest" : "") + ".");
      ({ records } = await built());
      hits = rank(records, query, { limit: HITS });
      left = await waiting();
    }

    const queryTerms = terms(query);
    const results = hits.map(({ record: r, snippet }) => {
      // A PDF's hit is placed on its page, so the source opens there.
      const page = r.kind === "file" && r.text ? pageWith(r.text, queryTerms) : null;
      // Only a match that came from the words themselves is evidence the answer came from there.
      if (snippet && r.kind === "file") {
        ctx.cite({ kind: "file", title: r.filename, course: r.course, courseId: r.courseId,
                   contentId: r.contentId, filename: r.filename, ...(page ? { pages: [page, page] } : {}) });
      } else if (snippet && r.kind === "material") {
        ctx.cite({ kind: "page", title: r.title, course: r.course, courseId: r.courseId,
                   contentId: r.contentId, href: r.webUrl ?? r.url ?? null });
      } else if (snippet && r.kind === "announcement") {
        ctx.cite({ kind: "announcement", title: r.title, course: r.course, href: "#/announcements" });
      }
      return {
        type: r.kind, title: r.title, course: r.course, course_id: r.courseId,
        ...(r.subtitle ? { where: r.subtitle } : {}),
        ...(r.contentId ? { content_id: r.contentId } : {}),
        ...(r.filename ? { file: r.filename, words_read: !!r.text } : {}),
        ...(page ? { page } : {}),
        ...(r.files?.length ? { files: r.files } : {}),
        ...(r.due ? { due: r.due } : {}),
        ...(snippet ? { snippet } : {}),
      };
    });

    return {
      query, results,
      ...(did.length ? { done_for_you: did } : {}),
      coverage: {
        courses_searched: courses.length,
        courses_not_opened_yet: unread.map((c) => c.label),
        documents_not_read_yet: left.files.length,
        ...(left.files.length ? {
          examples: left.files.slice(0, 8).map((f) => `${f.filename} (${f.course})`),
          advice: "Their words are not searchable yet, only their names. Read the likely ones " +
            "with read_course_item, or call again with read_unread: true.",
        } : { advice: "Everything readable in these courses has been read." }),
      },
    };
  },

  async browse_course_content({ course_id, query }) {
    need({ course_id }, "course_id");
    const tree = await sync.courseContent(course_id);
    const q = String(query ?? "").trim().toLowerCase();
    // A match keeps the folders above it, so it can be found again.
    const outline = (nodes, depth) => nodes.flatMap((n) => {
      const below = outline(n.children ?? [], depth + 1);
      const hit = !q || `${n.title} ${n.body ?? ""}`.toLowerCase().includes(q);
      if (!hit && !below.length) return [];
      const files = n.files?.length ? ` files: ${n.files.map((f) => f.filename).join(", ")}` : "";
      return [`${"  ".repeat(depth)}- ${n.title} [${n.type}${n.is_folder ? ", folder" : ""}] id=${n.content_id}${files}`, ...below];
    });
    const lines = outline(tree.nodes ?? [], 0);
    if (!lines.length) return q ? `Nothing in this course mentions "${query}".` : "This course has no content.";
    const shown = lines.slice(0, MAX_ROWS);
    return shown.join("\n") + (lines.length > shown.length ? `\n… ${lines.length - shown.length} more lines; narrow with query.` : "")
      + (tree.truncated ? "\n(The course was too large to read completely.)" : "");
  },

  async read_course_item({ course_id, content_id, file, start, pages }, ctx) {
    need({ course_id, content_id }, "course_id", "content_id");
    const find = (nodes) => {
      for (const n of nodes) {
        if (n.content_id === content_id) return n;
        const inner = find(n.children ?? []);
        if (inner) return inner;
      }
      return null;
    };
    const node = find((await sync.courseContent(course_id)).nodes ?? []);
    const label = await courseLabel(course_id);
    if (!file) {
      if (!node) throw new ToolError("No item with that content_id in this course.");
      ctx.cite({ kind: node.is_assignment ? "assignment" : "page", title: node.title, course: label,
                 courseId: course_id, contentId: content_id, href: node.web_url ?? node.url ?? null });
      return { title: node.title, type: node.type, text: node.body ?? "",
               files: (node.files ?? []).map((f) => f.filename), url: node.url ?? undefined };
    }
    const sources = await sync.fileSources(course_id, content_id);
    const want = String(file).toLowerCase();
    const source = sources.find((s) => s.filename.toLowerCase() === want)
      ?? sources.find((s) => s.filename.toLowerCase().includes(want));
    if (!source) {
      throw new ToolError(`No file like "${file}" on that item. It has: ${sources.map((s) => s.filename).join(", ") || "none"}.`);
    }
    if (!indexable(source.filename)) {
      throw new ToolError(`${source.filename} cannot be read from here (only Word, PowerPoint, PDF and text files can). ` +
        "Ask the student to paste the part they want help with.");
    }
    ctx.status(`Reading ${source.filename}`);
    const got = await sync.fetchBytes(source.url);
    let words;
    try {
      words = (await extractText(source.filename, got.blob)).trim();
    } catch (e) {
      throw new ToolError(`${source.filename} could not be opened: ${e.message}`);
    }
    if (!words) {
      return `${source.filename} has no readable text in it` +
        (/\.pdf$/i.test(source.filename) ? " — it is probably a scan of paper, which cannot be read here." : ".");
    }
    // What was just read is searchable from now on, whoever asked for it.
    search.rememberFileText({ courseId: course_id, contentId: content_id }, source.filename, words);
    const cite = (range) => ctx.cite({ kind: "file", title: source.filename, course: label, courseId: course_id,
                                       contentId: content_id, filename: source.filename, ...(range ? { pages: range } : {}) });
    if (!/\.pdf$/i.test(source.filename)) {
      cite(null);
      const from = Math.max(0, Math.floor(Number(start) || 0));
      const part = words.slice(from, from + MAX_FILE_TEXT);
      const end = from + part.length;
      return `${source.filename}, characters ${from}–${end} of ${words.length}:\n${part}` +
        (end < words.length ? `\n… more: call again with start=${end}.` : "");
    }

    // A PDF is read by page, and the pages read are what the source link opens at.
    const all = words.split(PAGE_BREAK);
    if (pages) {
      const wanted = parsePages(pages, all.length);
      if (!wanted.length) throw new ToolError(`"${pages}" names no page; the file has ${all.length}. Try "1" or "3-5".`);
      let body = wanted.map((n) => `[page ${n}]\n${all[n - 1]}`).join("\n\n");
      let shown = wanted;
      if (body.length > MAX_FILE_TEXT) {
        // Whole pages only: cut where a page ends rather than through one.
        let used = 0;
        shown = wanted.filter((n) => (used += all[n - 1].length + 12) <= MAX_FILE_TEXT);
        if (!shown.length) shown = [wanted[0]];
        body = shown.map((n) => `[page ${n}]\n${all[n - 1]}`).join("\n\n").slice(0, MAX_FILE_TEXT);
      }
      cite([shown[0], shown[shown.length - 1]]);
      return `${source.filename}, page${shown.length === 1 ? "" : "s"} ${shown.join(", ")} of ${all.length}:\n${body}` +
        (shown.length < wanted.length ? `\n… too long to show them all; continue with pages "${wanted[shown.length]}-${wanted[wanted.length - 1]}".` : "");
    }
    const marked = markPages(words);
    const from = Math.max(0, Math.floor(Number(start) || 0));
    const part = marked.slice(from, from + MAX_FILE_TEXT);
    const end = from + part.length;
    cite(pagesCovered(marked, from, end));
    return `${source.filename} (${all.length} pages), characters ${from}–${end} of ${marked.length}:\n${part}` +
      (end < marked.length ? `\n… more: call again with start=${end}, or ask for specific pages.` : "");
  },

  async list_announcements({ course_id, limit }, ctx) {
    const all = (await store.getData("announcements")) ?? [];
    const rows = all.filter((a) => !course_id || a.course_id === course_id)
      .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 30));
    if (rows.length) ctx.cite({ kind: "announcement", title: "Announcements", href: "#/announcements" });
    return rows.map((a) => ({ course: a.course, course_id: a.course_id, title: a.title, posted: a.posted, text: a.body }));
  },

  async get_grades({ course_id }, ctx) {
    const courses = (await store.getData("courses")) ?? [];
    const ids = course_id ? [course_id] : courses.map((c) => c.course_id);
    const out = [];
    for (const id of ids) {
      const s = await sync.courseStanding(id);
      const label = courses.find((c) => c.course_id === id)?.label ?? id;
      if (!s.accessible) { out.push({ course: label, note: s.reason }); continue; }
      ctx.cite({ kind: "grades", title: `Grades · ${label}`, course: label, courseId: id, href: "#/grades" });
      out.push({
        course: label, current_pct: s.current_pct, current_letter: s.current_letter,
        projected_pct: s.projected_pct, weighted_by: s.weighted_by,
        categories: s.categories.map((c) => ({
          title: c.title, weight: c.weight, pct: c.pct, earned: c.earned, graded_possible: c.graded_possible,
          ...(course_id ? { columns: c.columns } : {}),
        })),
      });
    }
    return out;
  },

  async create_document(args, ctx) {
    need(args, "title", "markdown");
    const item = await library.add({
      kind: "document", title: args.title.trim().slice(0, 140), markdown: args.markdown,
      course_id: args.course_id ?? null,
    });
    ctx.created(item);
    return `Showing "${item.title}" to the student beside the chat. Do not repeat it; say briefly what it is.`;
  },

  async create_quiz(args, ctx) {
    let quiz;
    try {
      quiz = normalizeQuiz(args);
    } catch (e) {
      if (e instanceof QuizError) throw new ToolError(`The quiz was not accepted. ${e.message} Fix it and call create_quiz again.`);
      throw e;
    }
    const item = await library.add({
      kind: "quiz", title: quiz.title.slice(0, 140), questions: quiz.questions,
      course_id: args.course_id ?? null,
    });
    ctx.created(item);
    return `The student is now taking "${item.title}" (${quiz.questions.length} questions) beside the chat. ` +
      "Do not repeat the questions or answers; say briefly what it covers.";
  },
};

/** Run one tool, always answering: a failure is text for Claude, never a throw. */
export async function run(name, args, ctx) {
  const handler = handlers[name];
  if (!handler) return { text: `No tool named ${name}.`, isError: true };
  // A caller that does not track sources or progress still gets answers.
  const context = { cite() {}, status() {}, created() {}, cancelled: () => false, ...ctx };
  try {
    const out = await handler(args && typeof args === "object" ? args : {}, context);
    return { text: clip(out), isError: false };
  } catch (e) {
    if (e instanceof ToolError) return { text: e.message, isError: true };
    // Not signed in, or Blackboard unreachable: say so in words rather than a stack.
    const why = e?.reason === "no-extension" ? "The Whiteboard Connector extension did not answer."
      : e?.message || String(e);
    return { text: `That did not work: ${why}`, isError: true };
  }
}
