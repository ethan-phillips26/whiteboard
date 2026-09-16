// Fetch through the extension, remember everything in IndexedDB, and only ask
// Blackboard again when an entry goes stale.

import * as A from "./attempts.js";
import * as E from "./edits.js";
import * as G from "./grades.js";
import * as store from "./store.js";
import { AuthError, BlackboardError, ForbiddenError, open } from "./blackboard.js";
import {
  GENERIC_TITLES, cmp, contentInstructions, courseLabel, courseTitle,
  extractEmbeddedFiles, filenameFromDisposition, htmlToText, isAssignmentColumn,
  launchUrl, localISO, parseBbTime, safeFilename, stripAttachmentLinks,
} from "./text.js";

const DAY = 864e5;
const nowIso = () => new Date().toISOString();
const round1 = (x) => Math.round(x * 10) / 10;

/* ------------------------------------------------------------------ refresh */

async function courseBundle(bb, courseId, uid) {
  const [cats, cols, grades] = await Promise.allSettled([
    bb.gradebookCategories(courseId),
    bb.gradebookColumns(courseId),
    bb.gradebookGrades(courseId, uid),
  ]);
  // A session that ended half way through is not a fact about this course.
  for (const r of [cats, cols, grades]) {
    if (r.status === "rejected" && r.reason instanceof AuthError) throw r.reason;
  }
  const failed = cols.status === "rejected";
  return {
    categories: cats.status === "fulfilled" ? cats.value : [],
    columns: failed ? [] : cols.value,
    grades: grades.status === "fulfilled" ? grades.value : {},
    accessible: !failed,
    // Specifically a 403: the instructor hid the gradebook. Any other failure also
    // leaves no columns, but a course must not vanish because one request timed out.
    hidden: failed && cols.reason instanceof ForbiddenError,
    error: failed ? String(cols.reason?.message ?? cols.reason) : null,
  };
}

/** What is outstanding, due from three days ago to sixty days out, from the
 * gradebook bundles already fetched. */
function dueDates(kept, { daysAhead = 60, daysBack = 3 } = {}) {
  const now = Date.now();
  const from = now - daysBack * DAY;
  const to = now + daysAhead * DAY;
  const items = [];
  const failures = [];
  for (const [course, bundle] of kept) {
    if (!bundle.accessible) {
      failures.push({ course: course.name, error: bundle.error });
      continue;
    }
    for (const col of bundle.columns) {
      // Calculated columns (Overall Grade, Weighted Total) are not work.
      if (!isAssignmentColumn(col)) continue;
      const due = parseBbTime(col.grading?.due);
      if (!due || due < from || due > to) continue;
      const st = bundle.grades[col.id] ?? {};
      const display = st.displayGrade ?? {};
      const score = "score" in display ? display.score : (st.score ?? null);
      // A row exists once there is something to report, but an ungraded
      // submission still has no score, so both signals count.
      const submitted = ["Graded", "NeedsGrading", "Completed"].includes(st.status) ||
        score != null || st.exempt === true;
      if (submitted) continue;
      items.push({
        title: col.name || "(untitled assignment)",
        course: courseLabel(course),
        course_name: courseTitle(course),
        course_id: course.id,
        column_id: col.id ?? null,
        // The handle for instructions and files; absent on a hand-made column.
        content_id: col.contentId ?? null,
        due_utc: due.toISOString(),
        due_local: localISO(due),
        days_until: round1((due - now) / DAY),
        points_possible: col.score?.possible ?? null,
        submitted,
        status: st.status ?? null,
        score,
      });
    }
  }
  items.sort((a, b) => cmp(a.due_utc, b.due_utc));
  return {
    count: items.length,
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    courses_checked: kept.length,
    terms: [...new Set(kept.map(([c]) => c.term).filter(Boolean))].sort(),
    items,
    ...(failures.length ? { partial_failures: failures } : {}),
  };
}

/** Record first-seen times so the UI can mark what is actually new. */
async function trackNew(due, announcements) {
  const seen = (await store.getData("seen")) ?? {};
  const assignments = seen.assignments ?? {};
  const posts = seen.announcements ?? {};
  const newAssignments = [];
  const newAnnouncements = [];
  for (const item of due.items ?? []) {
    const key = item.column_id || item.content_id;
    if (key && !(key in assignments)) {
      assignments[key] = nowIso();
      newAssignments.push(item.title);
    }
  }
  for (const a of announcements) {
    if (a.id && !(a.id in posts)) {
      posts[a.id] = nowIso();
      newAnnouncements.push(a.title);
    }
  }
  await store.write("seen", { assignments, announcements: posts });
  return { new_assignments: newAssignments, new_announcements: newAnnouncements };
}

async function doRefresh(force) {
  const stale = force || !(await store.fresh("assignments", "assignments"));
  if (!stale && (await store.read("courses"))) {
    return { refreshed: false, reason: "cache still fresh" };
  }

  const bb = await open();
  const uid = await bb.userId();
  const me = await bb.me();
  const courses = await bb.courses({ currentOnly: true });
  await store.write("me", { id: uid, name: me.name ?? null, username: me.userName ?? null });

  const bundles = await Promise.all(courses.map((c) => courseBundle(bb, c.id, uid)));
  // A course whose gradebook is hidden from students is dropped here, once,
  // rather than filtered on every screen.
  const dropped = courses.filter((_, i) => bundles[i].hidden).map(courseLabel);
  const kept = courses.map((c, i) => [c, bundles[i]]).filter(([, b]) => !b.hidden);

  await store.write("courses", kept.map(([c]) => ({
    course_id: c.id, code: c.course_id, label: courseLabel(c), title: courseTitle(c),
    name: c.name, term: c.term, web_url: c.external_url,
  })));
  await Promise.all(kept.map(([c, b]) => store.write(`course_${c.id}`, b)));

  const posted = await Promise.allSettled(kept.map(([c]) => bb.announcements(c.id)));
  const rows = [];
  kept.forEach(([c], i) => {
    if (posted[i].status !== "fulfilled") return;
    for (const a of posted[i].value) {
      rows.push({
        id: a.id, course_id: c.id, course: courseLabel(c), title: a.title,
        posted: a.created, body: htmlToText(a.body, { links: "markdown" }).slice(0, 4000),
      });
    }
  });
  rows.sort((a, b) => cmp(b.posted ?? "", a.posted ?? ""));
  await store.write("announcements", rows);

  const due = dueDates(kept);
  await store.write("assignments", due);
  const changes = await trackNew(due, rows);
  return { refreshed: true, at: nowIso(), hidden_gradebooks: dropped, ...changes };
}

// The dashboard asks for its data and its calendar at once, and a focus event
// can ask again mid-sync. One sync at a time; anyone arriving during it waits for
// that one rather than starting a second.
let inflight = null;

export function refresh(force = false) {
  inflight ??= doRefresh(force).finally(() => { inflight = null; });
  return inflight;
}

/* ------------------------------------------------------------------ content */

const FOLDER_TYPES = ["folder", "lesson"];
const ASSIGNMENT_TYPES = ["assignment", "asmt-test-link"];
// How deep to open folders, and the ceiling on requests for one course.
const CONTENT_DEPTH = 4;
const CONTENT_BUDGET = 80;
// Bump when a row grows a field or a field's meaning narrows, so a tree cached
// under the old shape is re-walked instead of served incomplete.
export const TREE_SCHEMA = 4;
const BODY_CHARS = 8000;
const BODY_HTML_CHARS = 24000;

function node(item, origin) {
  const handler = item.contentHandler ?? {};
  const kind = String(handler.id ?? "").replaceAll("resource/x-bb-", "") || "item";
  const body = contentInstructions(item);
  const files = extractEmbeddedFiles(body).map((f) => ({
    filename: f.filename, bytes: f.size, mime_type: f.mime_type, source: "inline",
  }));
  const attached = handler.file;
  if (attached && typeof attached === "object" && attached.fileName) {
    files.push({ filename: attached.fileName, bytes: null, mime_type: null, source: "attachment" });
  }
  return {
    content_id: item.id ?? null,
    title: (item.title ?? "").trim() || "(untitled)",
    type: kind,
    is_folder: FOLDER_TYPES.includes(kind) || !!item.hasChildren,
    is_assignment: ASSIGNMENT_TYPES.includes(kind),
    body_html: body.slice(0, BODY_HTML_CHARS),
    // An LTI item's URL is its tool's launch endpoint, which only answers
    // Blackboard's signed handoff; only an external link's URL is a place to go.
    url: kind === "externallink" ? handler.url ?? null : null,
    target_id: handler.targetId ?? null,
    grade_column_id: handler.gradeColumnId ?? null,
    files,
    position: item.position ?? null,
    modified: item.modified ?? null,
    created: item.created ?? null,
    web_url: origin ? launchUrl(item, origin) : null,
    children: [],
  };
}

function summariseTree(nodes) {
  const counts = { folders: 0, assignments: 0, files: 0, links: 0, items: 0 };
  const walk = (rows) => {
    for (const n of rows) {
      if (n.is_folder) counts.folders++;
      else {
        counts.items++;
        if (n.is_assignment) counts.assignments++;
        if (n.url) counts.links++;
      }
      counts.files += (n.files ?? []).length;
      walk(n.children ?? []);
    }
  };
  walk(nodes);
  return counts;
}

const generic = (title) => GENERIC_TITLES.has((title ?? "").trim());

/** Merge Ultra's wrapper folders into the one document each wraps. */
function folded(nodes) {
  return nodes.map((n) => {
    const children = folded(n.children ?? []);
    const only = children.length === 1 ? children[0] : null;
    if (n.is_folder && only && !only.is_folder && generic(only.title)) {
      return {
        ...only,
        title: n.title || only.title,
        position: n.position,
        body_html: (n.body_html ?? "") + (only.body_html ?? ""),
      };
    }
    return { ...n, children };
  });
}

const trimDash = (s) => s.replace(/^[ \-\t]+|[ \-\t]+$/g, "");

/** A title for a document Blackboard never named: its own first line, its one
 * file, or what it is. */
function named(n) {
  const title = (n.title ?? "").trim();
  if (!generic(title)) return title;
  const first = (n.body ?? "").split(/\r\n|\r|\n/).map(trimDash).find(Boolean) ?? "";
  if (first.length > 0 && first.length <= 80) return first;
  const files = n.files ?? [];
  if (files.length === 1 && files[0].filename) return files[0].filename.replace(/\.[^.]*$/, "");
  return "Document";
}

/** Flatten each body for the page on the way out, so a change to how course
 * text reads takes effect without waiting for the cache to go stale. */
function rendered(nodes) {
  return nodes.map((n) => {
    const { body_html: markup, ...out } = n;
    if (markup != null) {
      out.body = stripAttachmentLinks(htmlToText(markup, { links: "markdown" }),
        (n.files ?? []).map((f) => f.filename)).slice(0, BODY_CHARS);
    }
    out.body ??= "";
    out.title = named(out);
    out.children = rendered(n.children ?? []);
    return out;
  });
}

function presented(nodes) {
  const f = folded(nodes);
  return [rendered(f), summariseTree(f)];
}

export async function courseContent(courseId, force = false) {
  const key = `content_${courseId}`;
  const stored = (await store.getData(key)) ?? {};
  if (!force && (await store.fresh(key, "content")) && stored.schema === TREE_SCHEMA) {
    const [nodes, counts] = presented(stored.nodes ?? []);
    return { ...stored, nodes, counts, cached: true };
  }

  const bb = await open();
  let spent = 0;
  let truncated = false;

  const children = async (parent) => {
    if (spent >= CONTENT_BUDGET) {
      truncated = true;
      return [];
    }
    spent++;
    try {
      return await bb.contents(courseId, parent);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      return [];
    }
  };
  const position = (n) => (Number.isInteger(n.position) ? n.position : 1e6);
  const level = async (parent, depth) => {
    const nodes = (await children(parent)).map((item) => node(item, bb.origin));
    // Blackboard returns rows in menu order, usually; its position is the truth.
    nodes.sort((a, b) => position(a) - position(b));
    const openable = nodes.filter((n) => n.is_folder && n.content_id && depth < CONTENT_DEPTH);
    const kids = await Promise.all(openable.map((n) => level(n.content_id, depth + 1)));
    openable.forEach((n, i) => { n.children = kids[i]; });
    return nodes;
  };

  const tree = await level(null, 0);
  const entry = {
    course_id: courseId, accessible: true, nodes: tree, truncated,
    fetched_at: nowIso(), schema: TREE_SCHEMA,
  };
  await store.write(key, entry);
  const [nodes, counts] = presented(tree);
  return { ...entry, nodes, counts, cached: false };
}

/* ------------------------------------------------------------------- grades */

/** The gradebook rows that can move the grade. */
function gradeableColumns(bundle) {
  return (bundle.columns ?? []).filter((c) =>
    isAssignmentColumn(c) && (Number(c.score?.possible) || 0) > 0);
}

/** The student's percentages as fractions, for the categories this course has.
 * Keyed by category id, with "" for uncategorised rows; a key no category has — a
 * deleted category, an edit from an older version — matches nothing. */
function categoryWeights(stored, categories) {
  const known = new Set([...categories.map((c) => c.id).filter(Boolean), ""]);
  return Object.fromEntries(Object.entries(stored ?? {})
    .filter(([k]) => known.has(k))
    .map(([k, v]) => [k, Number(v) / 100]));
}

export async function courseStanding(courseId) {
  const bundle = (await store.getData(`course_${courseId}`)) ?? {};
  if (!(bundle.accessible ?? true)) {
    return { course_id: courseId, accessible: false,
             reason: "This course's gradebook is hidden from students." };
  }
  const categories = bundle.categories ?? [];
  const weights = categoryWeights(await E.weightsFor(courseId), categories);
  const breakdown = G.buildBreakdown(categories, gradeableColumns(bundle),
    bundle.grades ?? {}, weights);
  return {
    course_id: courseId,
    accessible: true,
    ...G.summarise(breakdown),
    weights_edited: Object.keys(weights).length > 0,
    available_categories: categories.map((c) => ({ id: c.id, title: c.title })),
  };
}

/* -------------------------------------------------------------- assignments */

// The shape of a cached assignment detail. Bump it when the shape changes, so an
// entry written under the old one is re-fetched rather than served stale.
const DETAIL_SCHEMA = 2;

/** A human title, falling back to the parent folder for Ultra's bodies. */
async function displayTitle(bb, courseId, item) {
  const title = (item.title ?? "").trim();
  if (!GENERIC_TITLES.has(title)) return title;
  if (item.parentId) {
    try {
      const parent = await bb.content(courseId, item.parentId);
      const parentTitle = (parent.title ?? "").trim();
      if (parentTitle && !GENERIC_TITLES.has(parentTitle)) return parentTitle;
    } catch (e) {
      if (e instanceof AuthError) throw e;
    }
  }
  return title || item.id || "content";
}

async function fetchAssignment(bb, courseId, contentId) {
  const item = await bb.content(courseId, contentId);
  const title = await displayTitle(bb, courseId, item);
  const body = contentInstructions(item);
  const classic = await bb.attachments(courseId, contentId);
  const files = [
    ...classic.map((a) => ({ attachment_id: a.id ?? null, filename: a.fileName ?? null,
                             mime_type: a.mimeType ?? null, source: "attachment" })),
    ...extractEmbeddedFiles(body).map((f) => ({ attachment_id: null, filename: f.filename,
                                                mime_type: f.mime_type, bytes: f.size,
                                                source: "inline" })),
  ];
  const handler = item.contentHandler ?? {};
  return {
    title,
    raw_title: item.title ?? null,
    course_id: courseId,
    content_id: contentId,
    instructions: htmlToText(body),
    instructions_html: body,
    created: item.created ?? null,
    modified: item.modified ?? null,
    type: (handler.id ?? "").replace("resource/x-bb-", "") || null,
    grade_column_id: handler.gradeColumnId ?? null,
    web_url: launchUrl(item, bb.origin),
    attachments: files,
  };
}

/** The detail as the page sees it: text rendered from the stored markup, and the
 * markup itself kept back. */
function present(detail) {
  const { instructions_html: markup, ...out } = detail;
  out.instructions = stripAttachmentLinks(
    markup ? htmlToText(markup, { links: "markdown" }) : detail.instructions,
    (detail.attachments ?? []).map((a) => a.filename));
  return out;
}

export async function assignment(courseId, contentId, refresh = false) {
  const key = `assignment_${courseId}_${contentId}`;
  const stored = (await store.getData(key)) ?? {};
  if (!refresh && (await store.fresh(key, "content")) && stored.schema === DETAIL_SCHEMA) {
    return { ...present(stored), cached: true };
  }
  const bb = await open();
  let detail;
  try {
    detail = await fetchAssignment(bb, courseId, contentId);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new BlackboardError(`Blackboard would not return this assignment: ${e.message}`);
  }
  await store.write(key, { ...detail, schema: DETAIL_SCHEMA });
  return { ...present(detail), cached: false };
}

/* -------------------------------------------------------------- submissions */

/** Your attempts at one gradebook column, with what was said about them. Kept as
 * long as grades are, since a grade arriving is exactly what changes one. */
// Bumped whenever the stored shape changes. 5: the grade's own feedback and any
// file returned with feedback, and nothing about the files handed in.
const SUBMISSIONS_SCHEMA = 5;

export async function submissions(courseId, columnId, refresh = false) {
  const key = `submissions_${courseId}_${columnId}`;
  const stored = await store.getData(key);
  if (!refresh && stored?.schema === SUBMISSIONS_SCHEMA && (await store.fresh(key, "grades"))) {
    return { ...stored, cached: true };
  }
  const bb = await open();
  const uid = await bb.userId();
  const [col, got, grades] = await Promise.allSettled([
    bb.column(courseId, columnId),
    bb.attempts(courseId, columnId),
    bb.gradebookGrades(courseId, uid),
  ]);
  for (const r of [col, got, grades]) {
    if (r.status === "rejected" && r.reason instanceof AuthError) throw r.reason;
  }
  const column = A.columnFromApi(col.status === "fulfilled" ? col.value : null);
  // The grade can say something no attempt does, or stand with no attempt at all.
  const grade = A.gradeFromApi(grades.status === "fulfilled" ? grades.value[columnId] : null);
  if (got.status === "rejected") {
    // Some schools close attempts to students through the API altogether. That
    // is an answer about the school, and the page says so rather than erroring.
    if (got.reason instanceof ForbiddenError) {
      return { column, grade, attempts: [], closed: true, cached: false };
    }
    throw new BlackboardError(
      `Blackboard would not return the submissions: ${got.reason?.message ?? got.reason}`);
  }
  // Only ever your own, whatever role Blackboard thinks you hold in the course.
  const mine = got.value.filter((a) => !a.userId || a.userId === uid);
  const attempts = mine.map((a) => A.attemptFromApi(a));
  // Oldest first, so "Attempt 1" is the first one you made.
  attempts.sort((a, b) => cmp(a.started ?? "", b.started ?? ""));
  const out = { schema: SUBMISSIONS_SCHEMA, column, grade, attempts, closed: false };
  await store.write(key, out);
  return { ...out, cached: false };
}

/* -------------------------------------------------------------------- files */

// Markup a course wrote is text to read, not a page to run: served as its own
// type from an object URL it would execute in this page's origin.
const AS_TEXT = /\.(html?|xhtml|svg|xml|xsl)$/i;
// Played, never fetched. A lecture recording does not fit in one message to the
// extension and nobody would wait for all of it before the first frame, so it is
// described here and the player asks for ranges instead (browser/stream.js).
const STREAMED = /\.(mp4|webm|m4v|ogv|mov)$/i;
// What a file is when its server only says "bytes" — enough for the viewer to
// draw what the browser can.
const TYPES = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm",
  mov: "video/quicktime", m4v: "video/mp4", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
};
const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function asFile(filename, { blob, bytes }) {
  const ext = (filename.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
  const viewType = AS_TEXT.test(filename) ? "text/plain;charset=utf-8"
    : GENERIC_TYPES.has(blob.type) ? TYPES[ext] ?? "application/octet-stream" : blob.type;
  return {
    filename,
    bytes,
    url: URL.createObjectURL(blob),
    view: URL.createObjectURL(new Blob([blob], { type: viewType })),
  };
}

// Downloads live for as long as the tab: object URLs in memory, keyed by item,
// so the second file pressed in a drawer is not fetched again.
const downloads = new Map();

async function fetchFiles(courseId, contentId) {
  const bb = await open();
  const item = await bb.content(courseId, contentId);
  const title = await displayTitle(bb, courseId, item);
  const attachments = await bb.attachments(courseId, contentId);
  const embedded = extractEmbeddedFiles(contentInstructions(item));
  if (!attachments.length && !embedded.length) {
    return { downloaded: [], note: `"${title}" has no attached files.` };
  }

  const downloaded = [];
  const failed = [];
  const taken = new Set();
  const unique = (name) => {
    let candidate = name;
    for (let n = 2; taken.has(candidate); n++) {
      candidate = name.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`);
    }
    taken.add(candidate);
    return candidate;
  };
  const grab = async (source, label) => {
    // Named from the label rather than the disposition, because finding out what
    // a server calls a file means fetching it, and this is the branch that does
    // not. A row with no `url` is not a failure here — it is a video.
    const streamName = safeFilename(label || "video", "video");
    if (STREAMED.test(streamName)) {
      // The type is settled here, from the name, for the same reason asFile does
      // it: Blackboard serves a lecture as "application/octet-stream" as often as
      // not, and a <video> handed that refuses to play anything at all.
      const ext = (streamName.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
      downloaded.push({
        filename: unique(streamName), original: label, streamable: true,
        source, type: TYPES[ext] ?? "video/mp4", bytes: null, url: null, view: null,
      });
      return;
    }
    try {
      const file = await bb.download(source);
      const name = safeFilename(label || filenameFromDisposition(file.disposition) || "attachment",
        "attachment");
      // `original` is Blackboard's own name for it, which is how the page asks for
      // a file; the saved name can differ once it is made safe to download.
      downloaded.push({ ...asFile(unique(name), file), original: label });
    } catch (e) {
      if (e instanceof AuthError) throw e;
      failed.push({ filename: label || "attachment", error: e.message });
    }
  };

  for (const a of attachments) {
    if (!a.id) continue;
    await grab(`/learn/api/public/v1/courses/${courseId}/contents/${contentId}/attachments/${a.id}/download`,
      a.fileName || a.id);
  }
  // Ultra links its handouts in the instructions rather than listing them.
  for (const f of embedded) await grab(f.url, f.filename);
  return { assignment: title, downloaded, ...(failed.length ? { failed } : {}) };
}

export function downloadFiles(courseId, contentId) {
  const key = `${courseId}/${contentId}`;
  if (!downloads.has(key)) {
    const pending = fetchFiles(courseId, contentId);
    downloads.set(key, pending);
    // Only a clean result is kept. The fix for a failed file is often a
    // permission granted a moment later, and pressing it again should try again.
    pending.then((r) => { if (r.failed?.length) downloads.delete(key); },
                 () => downloads.delete(key));
  }
  return downloads.get(key);
}

/** A file returned with feedback, fetched once per tab like a handout. Ultra
 * returns it as a Blackboard file link inside the feedback, fetched the way an
 * inline handout is. */
export function attemptFile(courseId, attemptId, file) {
  const key = `attempt/${attemptId}/${file.url}`;
  if (!downloads.has(key)) {
    const pending = (async () => {
      const bb = await open();
      const got = await bb.download(file.url);
      const name = safeFilename(
        file.name || filenameFromDisposition(got.disposition) || "submission", "submission");
      return asFile(name, got);
    })();
    downloads.set(key, pending);
    pending.catch(() => downloads.delete(key));
  }
  return downloads.get(key);
}

/** Drop everything this build holds — cache, corrections, downloads — and say how
 * many stored entries went. */
export async function forget() {
  const held = await Promise.allSettled(downloads.values());
  for (const r of held) {
    // An item's downloads are a set; a submitted file is held on its own.
    for (const f of r.value?.downloaded ?? (r.value?.url ? [r.value] : [])) {
      URL.revokeObjectURL(f.url);
      URL.revokeObjectURL(f.view);
    }
  }
  downloads.clear();
  return store.clear();
}
