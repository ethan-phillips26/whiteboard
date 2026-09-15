// edits.py for the browser build: local corrections, kept apart from the fetched
// data and re-applied on every read so a sync can never quietly undo one. Nothing
// here reaches Blackboard.

import * as store from "./store.js";
import { cmp, localISO } from "./text.js";

const KEY = "edits";

// What a student may change about an assignment; everything else stays
// whatever Blackboard says it is.
export const FIELDS = ["title", "due_utc", "points_possible", "hidden", "note"];

export async function load() {
  const stored = (await store.getData(KEY)) ?? {};
  return { assignments: stored.assignments ?? {}, weights: stored.weights ?? {} };
}

async function save(data) {
  await store.write(KEY, data);
  return data;
}

/** How an assignment is addressed. Matches the key first-seen tracking uses. */
export const itemKey = (item) => item.column_id || item.content_id || null;

/** Record an edit. A field set to null is a field handed back to Blackboard. */
export async function setAssignment(key, patch) {
  const data = await load();
  const current = { ...(data.assignments[key] ?? {}) };
  for (const field of FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value === null || value === "") delete current[field];
    else current[field] = value;
  }
  if (Object.keys(current).length) data.assignments[key] = current;
  else delete data.assignments[key];
  return save(data);
}

export async function clearAssignment(key) {
  const data = await load();
  delete data.assignments[key];
  return save(data);
}

/** What each gradebook category is worth, in percent, keyed by category id. */
export async function setWeights(courseId, weights) {
  const data = await load();
  const cleaned = Object.fromEntries(
    Object.entries(weights ?? {}).map(([k, v]) => [String(k), Number(v)]));
  if (Object.keys(cleaned).length) data.weights[courseId] = cleaned;
  else delete data.weights[courseId];
  return save(data);
}

export async function clearWeights(courseId) {
  const data = await load();
  delete data.weights[courseId];
  return save(data);
}

export async function weightsFor(courseId) {
  return (await load()).weights[courseId] ?? {};
}

/** A stored timestamp as a Date. One with no offset is UTC, as in edits.py. */
export function reparse(value) {
  if (!value) return null;
  const s = String(value);
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The assignment list as the student corrected it.
 *
 * A moved due date carries its derived fields with it — the local time, the
 * countdown and the list order all come from it — or an edit looks half-applied. */
export function applyAssignments(items, edits, { keepHidden = false } = {}) {
  const overrides = edits.assignments ?? {};
  if (!Object.keys(overrides).length) return items;
  const out = [];
  for (const item of items) {
    const patch = overrides[itemKey(item) ?? ""];
    if (!patch) {
      out.push(item);
      continue;
    }
    if (patch.hidden && !keepHidden) continue;
    const edited = { ...item, edited: Object.keys(patch).filter((k) => k !== "hidden").sort() };
    if (patch.hidden) edited.hidden = true;
    if (patch.title) edited.title = patch.title;
    if (patch.note) edited.note = patch.note;
    if ("points_possible" in patch) edited.points_possible = patch.points_possible;
    const due = reparse(patch.due_utc);
    if (due) {
      edited.due_utc = due.toISOString();
      edited.due_local = localISO(due);
      edited.days_until = Math.round((due - Date.now()) / 8640000) / 10;
    }
    out.push(edited);
  }
  // A moved deadline belongs where its new date puts it.
  return out.sort((a, b) => cmp(a.due_utc || "9999", b.due_utc || "9999"));
}
