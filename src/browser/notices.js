// Which announcements have already been popped up. The record lives in the
// browser, so a second browser shows a post once more. The first run baselines
// everything silently rather than stacking a term's posts in one modal.

import * as store from "./store.js";

const KEY = "announced";

export async function load() {
  const stored = await store.getData(KEY);
  const shown = stored && typeof stored === "object" ? stored.shown : null;
  return shown && typeof shown === "object" ? shown : {};
}

async function save(shown) {
  await store.write(KEY, { shown });
  return shown;
}

/** Record that these have been shown. Already-recorded ones keep their time. */
export async function mark(ids) {
  const shown = await load();
  const stamp = new Date().toISOString();
  for (const id of ids) if (id && !(id in shown)) shown[id] = stamp;
  return save(shown);
}

/** The ids worth popping up, newest first. */
export async function pending(announcements) {
  const ids = announcements.map((a) => a.id).filter(Boolean);
  if ((await store.read(KEY)) === null) {
    const stamp = new Date().toISOString();
    await save(Object.fromEntries(ids.map((id) => [id, stamp])));
    return [];
  }
  const shown = await load();
  return ids.filter((id) => !(id in shown));
}
