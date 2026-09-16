// Every call the screens make, answered in the page. There is no server: the
// Whiteboard Connector extension fetches from Blackboard (browser/bridge.js), and
// everything that has to be remembered lives in IndexedDB (browser/store.js).

import { save } from "./lib/download.js";
import { ask, present } from "./browser/bridge.js";
import { DEMO, modeUrl } from "./browser/mode.js";
import * as E from "./browser/edits.js";
import * as firstrun from "./browser/firstrun.js";
import * as G from "./browser/grades.js";
import * as google from "./browser/google.js";
import * as ics from "./browser/ics.js";
import * as N from "./browser/notices.js";
import * as search from "./browser/search.js";
import * as store from "./browser/store.js";
import * as sync from "./browser/sync.js";

/** An error that carries a status, the way callers expect to read one. */
function failure(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** The extension's answer, or its refusal as a thrown error. */
async function extension(msg) {
  const reply = await ask(msg);
  if (reply?.error) throw failure(reply.message || reply.error, 400);
  return reply;
}

async function authStatus() {
  if (!(await present())) return { logged_in: false, state: "no-extension", host: null };
  const s = await ask({ type: "status" });
  return {
    logged_in: s.state === "signed-in",
    state: s.state,
    host: s.host ?? null,
    user: s.user ?? null,
    detail: s.detail ?? null,
  };
}

async function state(refresh = false) {
  const status = await sync.refresh(refresh);
  const courses = (await store.getData("courses")) ?? [];
  const due = (await store.getData("assignments")) ?? {};
  const standings = {};
  for (const c of courses) {
    try {
      standings[c.course_id] = await sync.courseStanding(c.course_id);
    } catch (e) {
      // One bad course must not blank the dashboard.
      standings[c.course_id] = { course_id: c.course_id, accessible: false,
                                 reason: String(e.message).slice(0, 200) };
    }
  }
  const seen = (await store.getData("seen")) ?? {};
  const announcements = ((await store.getData("announcements")) ?? []).slice(0, 40);
  const edits = await E.load();
  // Hidden assignments leave the list the dashboard draws, but settings still
  // has to name them to offer them back.
  const withHidden = E.applyAssignments(due.items ?? [], edits, { keepHidden: true });
  const { items: _items, ...meta } = due;
  return {
    me: (await store.getData("me")) ?? {},
    courses,
    assignments: withHidden.filter((a) => !a.hidden),
    hidden_assignments: withHidden.filter((a) => a.hidden),
    assignment_meta: meta,
    announcements,
    standings,
    first_seen: seen.assignments ?? {},
    first_seen_announcements: seen.announcements ?? {},
    unannounced: await N.pending(announcements),
    edits,
    sync: status,
    cached_at: (await store.read("assignments"))?.fetched_at ?? null,
  };
}

async function calendar(refresh = false) {
  try {
    await sync.refresh(refresh);
  } catch {
    // The deadlines already known are still worth drawing.
  }
  const due = (await store.getData("assignments")) ?? {};
  const given = ((await store.getData("me"))?.name?.given ?? "").trim();
  return ics.build(E.applyAssignments(due.items ?? [], await E.load()), {
    calname: given ? `${given}'s coursework` : "Coursework",
    description: "Assignment due dates from Blackboard. Read-only.",
  });
}

export const api = {
  /** The iCalendar document the calendar grid renders. */
  calendar,
  /** Save the feed as a file, for importing into a calendar by hand. */
  exportCalendar: async () => {
    const url = URL.createObjectURL(
      new Blob([await calendar(false)], { type: "text/calendar;charset=utf-8" }));
    save(url, "coursework.ics");
    // After the click has had its chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  state,
  authStatus,
  /** Point the extension at a Blackboard; it asks for permission if it must. */
  connect: (host) => extension({ type: "connect", host }),
  /** Open Blackboard's own sign-in in a tab of its own. */
  signIn: () => extension({ type: "signin" }),
  logout: async () => {
    // Nothing here can end the Blackboard session itself — that belongs to the
    // browser's cookie jar — so "log out" forgets everything this app holds and
    // takes back the extension's permission to read Blackboard.
    await sync.forget();
    // The documents already in Drive are the student's own and are left there;
    // what goes is this browser's permission to put anything else in it.
    await google.disconnect();
    // The demo has nothing to disconnect; leaving it means going back to the real
    // page, and the navigation means this never needs to resolve.
    if (DEMO) {
      location.replace(modeUrl(false));
      return new Promise(() => {});
    }
    await ask({ type: "disconnect" });
    return authStatus();
  },
  /** Whether this is the demo, with made-up data. */
  demo: DEMO,
  assignment: (courseId, contentId) => sync.assignment(courseId, contentId),
  fetchFiles: (courseId, contentId) => sync.downloadFiles(courseId, contentId),
  submissions: (courseId, columnId, refresh = false) =>
    sync.submissions(courseId, columnId, refresh),
  attemptFile: (courseId, attemptId, file) => sync.attemptFile(courseId, attemptId, file),

  // Google Drive. The one thing this app writes anywhere, and it writes only to
  // the student's own Drive, only the file they pressed, and never to Blackboard.
  openInGoogle: (filename, getFile) => google.openInGoogle(filename, getFile),
  googleConnected: () => google.connected(),
  disconnectGoogle: () => google.disconnect(),
  refresh: () => sync.refresh(true),
  /** Delete everything fetched, derived or downloaded. The login is not touched.
   *
   * A clean slate includes the welcome. Logging out deliberately does not bring
   * the tour back — that would nag anyone who signs out routinely — but someone
   * who has just emptied the app is starting again, and the tour is what
   * starting again looks like. */
  resetData: async () => {
    const entries = await sync.forget();
    firstrun.clear();
    return { cache_entries: entries, files: 0, bytes: 0, kept: ["Blackboard login"] };
  },
  /** Record that these announcements have been popped up, so they are not again. */
  markAnnounced: async (ids) => ({ announced: Object.keys(await N.mark(ids)).length }),
  courseContent: (courseId, refresh = false) => sync.courseContent(courseId, refresh),

  // Global search. The corpus is everything the page already holds plus whatever
  // has been read of each course; warming is what reads the rest, in the
  // background, while the field is already answering.
  searchCorpus: (state) => search.corpus(state),
  warmSearch: (courses, onRead) => search.warm(courses, onRead),
  /** How much of the term can be read, and how much already has been. */
  indexStatus: (courses) => search.indexStatus(courses),
  /** Read every document there is, so search covers what they say. */
  indexFiles: (courses, options) => search.indexFiles(courses, options),
  clearFileIndex: () => search.clearIndex(),

  // Whether this browser has been shown the welcome. A browser preference, kept
  // out of the cache so that logging out does not start the tour again.
  welcomed: () => firstrun.seen(),
  markWelcomed: () => firstrun.mark(),

  needed: async (courseId, columnId, target, rate) => {
    const standing = await sync.courseStanding(courseId);
    if (!standing.accessible) throw failure(standing.reason ?? "Gradebook not accessible.", 403);
    const breakdown = standing.categories.map((c) => ({
      category_id: c.category_id, title: c.title, weight: c.weight,
      earned: c.earned, graded_possible: c.graded_possible,
      total_possible: c.total_possible,
      remaining_possible: c.total_possible - c.graded_possible,
      pct_graded: c.pct, columns: c.columns,
    }));
    const result = G.neededOn(breakdown, columnId, target, rate);
    if (!result) throw failure("That assignment is not in this course's gradebook.", 404);
    return result;
  },

  // Local corrections. These never reach Blackboard — they change what this
  // dashboard shows and what its calendar publishes.
  edits: () => E.load(),
  editAssignment: async (key, patch) => {
    const clean = Object.fromEntries(
      Object.entries(patch ?? {}).filter(([k]) => E.FIELDS.includes(k)));
    if (!Object.keys(clean).length) throw failure("Nothing to change.", 400);
    if (clean.due_utc && !E.reparse(clean.due_utc)) {
      throw failure(`"${clean.due_utc}" is not a date I can read.`, 400);
    }
    return E.setAssignment(key, clean);
  },
  resetAssignment: (key) => E.clearAssignment(key),
  editWeights: async (courseId, weights) => {
    for (const [label, pct] of Object.entries(weights ?? {})) {
      if (!(pct >= 0 && pct <= 100)) throw failure(`"${label}": ${pct} is not a percentage.`, 400);
    }
    await E.setWeights(courseId, weights);
    return sync.courseStanding(courseId);
  },
  resetWeights: async (courseId) => {
    await E.clearWeights(courseId);
    return sync.courseStanding(courseId);
  },
};
