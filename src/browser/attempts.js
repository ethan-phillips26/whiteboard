// Your own attempts at one gradebook column, shaped for the page. Pure: what the
// sync fetched goes in, what the drawer draws comes out.

import { extractEmbeddedFiles, htmlToText, stripAttachmentLinks } from "./text.js";

// Blackboard's attempt statuses, said the way a student would, with the flag tone
// each one is drawn in.
const STATUS = {
  NotAttempted: ["not submitted", null],
  InProgress: ["started, not submitted", "warn"],
  Suspended: ["suspended", "warn"],
  Abandoned: ["abandoned", null],
  Canceled: ["cancelled", null],
  NeedsGrading: ["submitted, not graded yet", null],
  Completed: ["graded", "ok"],
  InProgressFromReconciliation: ["being reconciled", null],
};

const SCORING = {
  Last: "the last attempt",
  First: "the first attempt",
  Highest: "the highest attempt",
  Lowest: "the lowest attempt",
  Average: "the average of the attempts",
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Markup is read the way the instructions are, with links kept as links. Files
// linked inside feedback are pulled out to be opened: Ultra returns a marked-up
// copy as a link in the text. Both readers need the browser's parser, so a test
// passes its own.
const READERS = {
  toText: (html) => htmlToText(html, { links: "markdown" }),
  embedded: (html) => extractEmbeddedFiles(html),
};

function reader(given = {}) {
  const toText = given.toText ?? READERS.toText;
  const embedded = given.embedded ?? READERS.embedded;
  const has = (html) => html != null && String(html).trim() !== "";
  const files = (html) => (has(html) ? embedded(String(html)) : [])
    .filter((f) => f?.url)
    .map((f) => ({ id: null, url: f.url, name: f.filename || "file" }));
  const prose = (html) => {
    if (!has(html)) return null;
    const names = files(html).map((f) => f.name);
    const text = toText(String(html));
    // A file listed below is not also a link in the text above it.
    return (names.length ? stripAttachmentLinks(text, names) : text).trim() || null;
  };
  return { prose, files };
}

/** What the column says about attempts in general. */
export function columnFromApi(raw) {
  const grading = raw?.grading ?? {};
  const allowed = num(grading.attemptsAllowed);
  return {
    name: raw?.name ?? null,
    possible: num(raw?.score?.possible),
    due: grading.due ?? null,
    // Only a real limit is worth saying; what an absent or zero one means differs
    // between Blackboard versions.
    attempts_allowed: allowed && allowed > 0 ? allowed : null,
    scoring: SCORING[grading.scoringModel] ?? null,
  };
}

/** The grade itself. It carries feedback of its own when an instructor grades
 * from the gradebook rather than an attempt — including where nothing was
 * handed in at all. */
export function gradeFromApi(raw, readers) {
  if (!raw) return null;
  const read = reader(readers);
  const display = raw.displayGrade ?? {};
  return {
    score: num(display.score) ?? num(raw.score),
    grade_text: display.text ?? raw.text ?? null,
    exempt: raw.exempt === true,
    feedback: read.prose(raw.feedback),
    feedback_files: read.files(raw.feedback),
  };
}

/** One attempt: its status, grade, dates, and what was said about it. The files
 * handed in are not read — some schools refuse students the list outright. */
export function attemptFromApi(raw, readers) {
  const read = reader(readers);
  const [label, tone] = STATUS[raw?.status] ?? [raw?.status ? String(raw.status) : "unknown", null];
  const display = raw?.displayGrade ?? {};
  const receipt = raw?.attemptReceipt ?? null;
  return {
    id: raw?.id ?? null,
    status: raw?.status ?? null,
    status_label: label,
    tone,
    score: num(display.score) ?? num(raw?.score),
    // A letter or "Complete" where the column is not graded in points.
    grade_text: display.text ?? raw?.text ?? null,
    exempt: raw?.exempt === true,
    group: !!raw?.groupAttemptId,
    started: raw?.created ?? null,
    submitted: raw?.attemptDate ?? receipt?.submissionDate ?? null,
    modified: raw?.modified ?? null,
    feedback: read.prose(raw?.feedback),
    feedback_files: read.files(raw?.feedback),
    submission: read.prose(raw?.studentSubmission),
    comments: read.prose(raw?.studentComments),
  };
}
