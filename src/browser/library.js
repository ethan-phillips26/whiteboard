// What Claude has made for the student: documents and practice quizzes. Kept so a
// quiz can be taken again next week, and in the same store as everything else, so
// logging out empties it too — the Claude tab says so.

import * as store from "./store.js";

const KEY = "claude_library";
const ATTEMPTS_KEPT = 20;

export async function load() {
  return (await store.getData(KEY)) ?? [];
}

const save = async (items) => { await store.write(KEY, items); return items; };

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/[^A-Za-z0-9]/g, "").slice(0, 16);

/** A document (`markdown`) or a quiz (`questions`), newest first. */
export async function add(item) {
  const made = { id: newId(), created: new Date().toISOString(), ...item };
  await save([made, ...(await load())]);
  return made;
}

export async function remove(id) {
  return save((await load()).filter((i) => i.id !== id));
}

/** A finished run of a quiz: just the score, so the library can say how it went. */
export async function recordAttempt(id, attempt) {
  return save((await load()).map((i) => i.id !== id ? i : {
    ...i,
    attempts: [{ at: new Date().toISOString(), ...attempt }, ...(i.attempts ?? [])]
      .slice(0, ATTEMPTS_KEPT),
  }));
}
