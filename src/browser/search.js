// Everything there is to search, gathered in the page.
//
// The dashboard already holds the courses, the deadlines and the announcements,
// so those cost nothing. A course's material is the expensive part: the tree is
// walked only when its Materials tab is opened, and walking one costs up to
// CONTENT_BUDGET requests through the extension. Searching therefore runs
// immediately over whatever has been read, and asks for the rest in the
// background — a search that waited for every course to be walked before showing
// its first row would be a search nobody used.
//
// Nothing here fetches a file. What a handout *says* is only searchable once it
// has been opened and read in the page, which is what rememberFileText records.

import { extractText, indexable } from "../lib/extract.js";
import * as store from "./store.js";
import { cachedContent, courseContent, fetchBytes, fileSources } from "./sync.js";

// A term's worth of course text is worth keeping; a whole textbook is not, and
// the point of the extract is to find the document, not to be the document.
const MAX_TEXT = 40000;

const textKey = (courseId, contentId, filename) =>
  `filetext_${courseId}_${contentId}_${filename}`;

/**
 * Remember what a document turned out to say.
 *
 * Called by the reader once it has drawn a file, because that is the one moment
 * the text exists in the page without anything extra being fetched. Keyed by the
 * item it hangs off as well as its name: two courses both post "syllabus.pdf",
 * and attributing one's text to the other's hit is worse than having no snippet.
 */
export async function rememberFileText(origin, filename, text) {
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!origin?.courseId || !origin?.contentId || !filename || !body) return;
  try {
    await store.write(textKey(origin.courseId, origin.contentId, filename),
                      body.slice(0, MAX_TEXT));
  } catch {
    // Search is better with it and correct without it.
  }
}

/** Every extract this browser holds, keyed as it was written. */
async function storedText() {
  const out = new Map();
  try {
    for (const key of await store.keys()) {
      if (typeof key === "string" && key.startsWith("filetext_")) {
        out.set(key, await store.getData(key));
      }
    }
  } catch {
    // An unreadable store means no snippets, not no search.
  }
  return out;
}

/* ------------------------------------------------------------------ records */

const KIND_BOOST = {
  command: 40,
  course: 30,
  assignment: 24,
  announcement: 12,
  material: 6,
  file: 4,
};

function courseRecords(courses) {
  return courses.map((c) => ({
    kind: "course",
    id: `course:${c.course_id}`,
    title: c.label,
    subtitle: c.title && c.title !== c.label ? c.title : "",
    course: c.label,
    courseId: c.course_id,
    boost: KIND_BOOST.course,
  }));
}

function assignmentRecords(assignments) {
  return assignments.map((a) => ({
    kind: "assignment",
    id: `assignment:${a.course_id}:${a.column_id ?? a.content_id}`,
    title: a.title,
    course: a.course,
    courseId: a.course_id,
    contentId: a.content_id ?? null,
    columnId: a.column_id ?? null,
    due: a.due_local ?? null,
    points: a.points_possible ?? null,
    boost: KIND_BOOST.assignment,
  }));
}

function announcementRecords(announcements) {
  return announcements.map((a, i) => ({
    kind: "announcement",
    id: `announcement:${a.id ?? i}`,
    title: a.title || "(untitled)",
    body: a.body ?? "",
    course: a.course,
    courseId: a.course_id,
    posted: a.posted ?? null,
    boost: KIND_BOOST.announcement,
  }));
}

/**
 * One course's tree, flattened.
 *
 * A folder is not a destination — nobody searches for "Week 3" meaning the
 * folder rather than what is in it — so folders contribute their name to the
 * path of what they contain and are not listed themselves. Each file becomes a
 * row of its own, because the file is usually what was actually wanted.
 */
export function treeRecords(nodes, course, extracts = new Map(), trail = [], out = []) {
  for (const node of nodes ?? []) {
    const path = [...trail, node.title].filter(Boolean);
    if (node.is_folder) {
      treeRecords(node.children ?? [], course, extracts, path, out);
      continue;
    }
    const files = (node.files ?? []).map((f) => f.filename).filter(Boolean);
    const where = trail.join(" › ");
    out.push({
      kind: "material",
      id: `material:${course.course_id}:${node.content_id ?? node.title}`,
      title: node.title,
      subtitle: where,
      body: node.body ?? "",
      files,
      course: course.label,
      courseId: course.course_id,
      contentId: node.content_id ?? null,
      columnId: node.grade_column_id ?? null,
      type: node.type,
      url: node.url ?? null,
      webUrl: node.web_url ?? null,
      openable: !!node.content_id && (node.is_assignment || files.length > 0),
      boost: KIND_BOOST.material,
    });
    for (const filename of files) {
      out.push({
        kind: "file",
        id: `file:${course.course_id}:${node.content_id}:${filename}`,
        title: filename,
        subtitle: [where, node.title].filter(Boolean).join(" › "),
        text: extracts.get(textKey(course.course_id, node.content_id, filename)) ?? "",
        course: course.label,
        courseId: course.course_id,
        contentId: node.content_id ?? null,
        filename,
        boost: KIND_BOOST.file,
      });
    }
    treeRecords(node.children ?? [], course, extracts, path, out);
  }
  return out;
}

/**
 * Everything searchable that this browser already knows, plus which courses it
 * has never read. The order is the tie-break the ranker falls back on, so it
 * runs widest-first: a course, then the work, then the material inside it.
 */
export async function corpus({ courses = [], assignments = [], announcements = [] } = {}) {
  const extracts = await storedText();
  const records = [
    ...courseRecords(courses),
    ...assignmentRecords(assignments),
    ...announcementRecords(announcements),
  ];
  const unread = [];
  for (const course of courses) {
    const content = await cachedContent(course.course_id);
    if (!content) {
      unread.push(course);
      continue;
    }
    records.push(...treeRecords(content.nodes, course, extracts));
  }
  return { records, unread };
}

/* ------------------------------------------------------------------ warming */

// One walk per course at a time, and never a second walk of a course this tab
// has already read — a palette opened, closed and opened again should cost
// nothing the second time.
const walking = new Map();

function walk(courseId) {
  if (!walking.has(courseId)) {
    const pending = courseContent(courseId);
    walking.set(courseId, pending);
    // Kept on success so the course is never walked twice; dropped on failure,
    // because the fix is often a permission granted a moment later.
    pending.catch(() => walking.delete(courseId));
  }
  return walking.get(courseId);
}

/**
 * Read the courses search has never seen, one at a time, reporting after each.
 *
 * Sequential on purpose: each course is already tens of requests, and firing
 * every course at once would put the extension's worker under a burst that the
 * screen the reader is actually looking at has to compete with.
 *
 * Only courses with no tree at all are read. A stale tree is still a perfectly
 * good answer to "where are the slides", and re-walking the whole term every
 * six hours to refresh it is not a cost a keystroke should carry.
 */
/* ----------------------------------------------------------------- indexing */

// Enough of a failure list to see the pattern, not enough to fill the screen or
// the tab's memory when a whole term will not come down.
const MAX_FAILURES = 20;

/** Every file in a course that could be read, with the item it hangs off. */
function targets(nodes, out = []) {
  for (const node of nodes ?? []) {
    if (!node.is_folder && node.content_id) {
      for (const f of node.files ?? []) {
        if (f.filename && indexable(f.filename)) {
          out.push({ contentId: node.content_id, filename: f.filename });
        }
      }
    }
    targets(node.children ?? [], out);
  }
  return out;
}

/**
 * How much of the term is readable, and how much has been read.
 *
 * Counted from trees already held, so opening Settings costs nothing. Courses
 * never walked are reported rather than fetched: the count would otherwise be a
 * term's worth of requests for a line of text nobody asked to be accurate.
 */
export async function indexStatus(courses = []) {
  const held = new Set((await store.keys())
    .filter((k) => typeof k === "string" && k.startsWith("filetext_")));
  let readable = 0;
  let indexed = 0;
  let unread = 0;
  for (const course of courses) {
    const tree = await cachedContent(course.course_id);
    if (!tree) {
      unread++;
      continue;
    }
    for (const t of targets(tree.nodes)) {
      readable++;
      if (held.has(textKey(course.course_id, t.contentId, t.filename))) indexed++;
    }
  }
  return { readable, indexed, unread };
}

/**
 * Read every document in every course, so their contents are searchable.
 *
 * The expensive thing the app can do, and the only one it asks for out loud.
 * Every file is fetched whole through the extension, read for its text, and then
 * dropped — what is kept is the words, which is kilobytes, rather than the
 * files, which is not. Anything already read is skipped, so running it twice
 * costs almost nothing and a run that was stopped half way can be resumed.
 *
 * Sequential, and stoppable between files: this is competing with whatever the
 * reader is actually doing, and it is their bandwidth.
 */
export async function indexFiles(courses = [], { onProgress, shouldStop } = {}) {
  const tally = { indexed: 0, skipped: 0, failed: 0, failures: [] };
  const note = (filename, error) => {
    tally.failed++;
    if (tally.failures.length < MAX_FAILURES) tally.failures.push({ filename, error });
  };

  // Worked out in full first, so the progress bar means something from the
  // start. A course never walked is walked here, since indexing a course whose
  // contents are unknown would silently do nothing.
  const jobs = [];
  for (const course of courses) {
    let tree = null;
    try {
      tree = (await cachedContent(course.course_id)) ?? (await courseContent(course.course_id));
    } catch (e) {
      note(course.label, `couldn't read the course: ${e.message}`);
      continue;
    }
    for (const t of targets(tree?.nodes ?? [])) jobs.push({ course, ...t });
  }

  const total = jobs.length;
  let done = 0;
  await onProgress?.({ done, total, ...tally });

  // One item's files arrive from one pair of requests, so they are fetched as a
  // group rather than one item lookup per file.
  const groups = new Map();
  for (const job of jobs) {
    const key = `${job.course.course_id}/${job.contentId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }

  for (const group of groups.values()) {
    if (shouldStop?.()) return { ...tally, total, done, stopped: true };
    const { course, contentId } = group[0];
    const origin = { courseId: course.course_id, contentId };

    // What is already read is settled before anything is fetched, so a second
    // run over a course costs no requests at all.
    const pending = [];
    for (const job of group) {
      if (await store.read(textKey(course.course_id, contentId, job.filename))) {
        tally.skipped++;
        done++;
      } else pending.push(job);
    }
    if (!pending.length) {
      await onProgress?.({ done, total, course: course.label, ...tally });
      continue;
    }

    let sources = [];
    try {
      sources = await fileSources(course.course_id, contentId);
    } catch (e) {
      for (const job of pending) {
        note(job.filename, e.message);
        done++;
      }
      await onProgress?.({ done, total, course: course.label, ...tally });
      continue;
    }

    for (const job of pending) {
      if (shouldStop?.()) return { ...tally, total, done, stopped: true };
      done++;
      await onProgress?.({ done, total, course: course.label, filename: job.filename, ...tally });
      const source = sources.find((s) => s.filename === job.filename);
      if (!source) {
        // The tree named a file the item no longer offers: posted and pulled, or
        // renamed since the tree was walked.
        note(job.filename, "Blackboard no longer lists this file on the item.");
        continue;
      }
      try {
        const got = await fetchBytes(source.url);
        const text = await extractText(job.filename, got.blob);
        if (text.trim()) {
          await rememberFileText(origin, job.filename, text);
          tally.indexed++;
        } else {
          // It came down and had nothing in it worth keeping — an empty deck, a
          // document that is one picture. Not a failure.
          tally.skipped++;
        }
      } catch (e) {
        note(job.filename, e.message);
      }
    }
  }

  return { ...tally, total, done, stopped: false };
}

/** Forget every extract, without touching anything else that is cached. */
export async function clearIndex() {
  const keys = (await store.keys())
    .filter((k) => typeof k === "string" && k.startsWith("filetext_"));
  for (const key of keys) await store.drop(key);
  return keys.length;
}

export async function warm(courses, onRead) {
  for (const course of courses) {
    try {
      await walk(course.course_id);
      await onRead?.(course);
    } catch {
      // A course that will not open is one course missing from the results, and
      // the palette says how many are still unread rather than claiming none.
      await onRead?.(course);
    }
  }
}
