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

import * as store from "./store.js";
import { cachedContent, courseContent } from "./sync.js";

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
