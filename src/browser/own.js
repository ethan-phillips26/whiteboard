// Work Blackboard never hears about: a paper handed in at the start of class, a
// lab report, a reading. The student writes these in, and they sit beside
// Blackboard's deadlines everywhere those are drawn — the list, the countdown,
// the calendar and the exported .ics. Nothing here reaches Blackboard.
//
// They are kept apart from the fetched data, like edits, so a sync never touches
// them. They are the one thing in the store that was typed rather than fetched,
// and logging out empties the store all the same.

import * as store from "./store.js";
import { cmp, localISO } from "./text.js";

const KEY = "own";

// Anything the student may set; everything else is derived on read.
export const FIELDS = ["title", "course_id", "course", "course_name", "due_utc",
  "description", "done"];

// How far back an unfinished item stays in the outstanding list — the same
// grace Blackboard's own deadlines get (`dueDates` in sync.js). The calendar
// keeps everything.
const DAYS_BACK = 3;
const DAY = 86400000;

export async function load() {
  return (await store.getData(KEY)) ?? [];
}

async function save(items) {
  await store.write(KEY, items);
  return items;
}

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/[^A-Za-z0-9]/g, "").slice(0, 20);

function pick(patch) {
  return Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => FIELDS.includes(k)));
}

export async function add(fields) {
  const items = await load();
  const item = { id: newId(), created: new Date().toISOString(), ...pick(fields) };
  items.push(item);
  await save(items);
  return item;
}

export async function update(id, patch) {
  const items = await load();
  const at = items.findIndex((i) => i.id === id);
  if (at < 0) return null;
  items[at] = { ...items[at], ...pick(patch) };
  await save(items);
  return items[at];
}

export async function remove(id) {
  const items = await load();
  await save(items.filter((i) => i.id !== id));
}

/**
 * Stored items in the shape Blackboard's deadlines have, so nothing that draws
 * one needs to know which is which beyond `own_id`.
 *
 * The course's label and name are read from the current course list when it
 * still has the course, so a renamed course is renamed here too; the copy taken
 * when the item was written stands in once the course has gone.
 */
export function asAssignments(items, courses = [], now = Date.now()) {
  const byId = new Map(courses.map((c) => [c.course_id, c]));
  return items.map((item) => {
    const course = byId.get(item.course_id);
    const due = item.due_utc ? new Date(item.due_utc) : null;
    const valid = due && !Number.isNaN(due.getTime());
    return {
      own_id: item.id,
      own: true,
      title: item.title || "(untitled)",
      course: course?.label ?? item.course ?? "",
      course_name: course?.title ?? item.course_name ?? null,
      course_id: item.course_id ?? null,
      column_id: null,
      content_id: null,
      due_utc: valid ? due.toISOString() : null,
      due_local: valid ? localISO(due) : null,
      days_until: valid ? Math.round((due - now) / 8640000) / 10 : null,
      points_possible: null,
      description: item.description ?? "",
      // "done" plays the part Blackboard's submission does: it takes the item
      // out of what is outstanding and marks it in the calendar.
      submitted: !!item.done,
    };
  }).sort((a, b) => cmp(a.due_utc || "9999", b.due_utc || "9999"));
}

/** Whether an item belongs in the outstanding list rather than only the calendar. */
export const outstanding = (row, now = Date.now()) =>
  !row.submitted && (!row.due_utc || new Date(row.due_utc).getTime() >= now - DAYS_BACK * DAY);
