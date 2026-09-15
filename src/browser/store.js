// The knowledge store: {fetched_at, data, …} under a key, with per-kind TTLs,
// kept in IndexedDB. localStorage would
// be simpler and is capped at a few megabytes, which a term's content trees
// outgrow. Where IndexedDB is refused (some private windows), the store lives in
// memory for the tab instead: slower to come back, never wrong.

import { DEMO } from "./mode.js";

// The demo keeps its own database, so trying it never touches real data.
const DB = DEMO ? "whiteboard-demo" : "whiteboard";
const STORE = "cache";

// How long each kind of fetched data stays fresh, in seconds.
export const TTL = {
  courses: 6 * 3600,
  categories: 24 * 3600,
  assignments: 900,
  grades: 900,
  announcements: 900,
  content: 6 * 3600,
};

const memory = new Map();
let opened = null;

function db() {
  opened ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

async function run(mode, op, fallback) {
  const d = await db();
  if (!d) return fallback(memory);
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function read(key) {
  return (await run("readonly", (s) => s.get(key), (m) => m.get(key))) ?? null;
}

export async function write(key, data, extra = {}) {
  const entry = { fetched_at: new Date().toISOString(), data, ...extra };
  await run("readwrite", (s) => s.put(entry, key), (m) => m.set(key, entry));
  return entry;
}

export async function getData(key, fallback = null) {
  const entry = await read(key);
  return entry && "data" in entry ? entry.data : fallback;
}

/** Seconds since this key was written, or null if it never was. */
export async function age(key) {
  const entry = await read(key);
  const at = Date.parse(entry?.fetched_at ?? "");
  return Number.isNaN(at) ? null : (Date.now() - at) / 1000;
}

export async function fresh(key, kind = null, ttl = null) {
  const limit = ttl ?? TTL[kind ?? key.split("/")[0]] ?? 900;
  const seconds = await age(key);
  return seconds !== null && seconds < limit;
}

export const keys = () =>
  run("readonly", (s) => s.getAllKeys(), (m) => [...m.keys()]);

export const drop = (key) =>
  run("readwrite", (s) => s.delete(key), (m) => m.delete(key));

/** Empty the store, and say how many entries went. */
export async function clear() {
  const count = (await keys()).length;
  await run("readwrite", (s) => s.clear(), (m) => m.clear());
  return count;
}
