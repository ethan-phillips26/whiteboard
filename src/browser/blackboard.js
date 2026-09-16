// Blackboard's REST API, read through the extension: the endpoints, the paging,
// and what each failure means.

import { ask } from "./bridge.js";
import { cmp, parseBbTime } from "./text.js";

export class BlackboardError extends Error {}

/** The session is missing or has ended. */
export class AuthError extends BlackboardError {
  constructor(message) {
    super(message);
    this.reason = "signed-out";
  }
}

/** The session is fine; this course or item is closed to students. */
export class ForbiddenError extends BlackboardError {}

const RETRY = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// At most six requests in flight: a sync fans
// out to several requests per course, and forty at once is the shape a school's
// load balancer throttles.
const LIMIT = 6;
let active = 0;
const queue = [];

async function limited(fn) {
  while (active >= LIMIT) await new Promise((resolve) => queue.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

function withQuery(path, params) {
  if (!params) return path;
  const [base, query = ""] = path.split("?");
  const q = new URLSearchParams(query);
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  return `${base}?${q}`;
}

function failure(reply, path) {
  switch (reply.error) {
    case "signed-out":
    case "not-connected":
      return new AuthError("Your Blackboard session has ended — sign in again.");
    case "forbidden":
      return new ForbiddenError(
        `Blackboard returned 403 for ${path}. The session is fine; this is closed to students.`);
    case "http":
      return new BlackboardError(reply.status === 404
        ? `Not found: ${path}`
        : `Blackboard returned ${reply.status} for ${path}.`);
    // An extension older than the page. Once the extension comes from a store,
    // the two update on their own schedules — the site the moment it deploys,
    // the extension when review ends and a browser gets round to it — so they
    // really can be out of step, and the worker's own "No such request: range"
    // is not something a student can do anything with.
    case "unknown":
      return new BlackboardError(
        "This needs a newer Whiteboard Connector than the one installed. Update the " +
        "extension, then reload this page.");
    default:
      return new BlackboardError(reply.message || `Blackboard request failed (${reply.error}).`);
  }
}

async function request(msg, path) {
  for (let attempt = 0; ; attempt++) {
    const timeout = msg.type === "file" ? 180000 : msg.type === "range" ? 120000 : 60000;
    const reply = await limited(() => ask(msg, timeout));
    if (reply.ok) return reply;
    const transient = reply.error === "network" ||
      (reply.error === "http" && RETRY.has(reply.status));
    if (!transient || attempt >= 3) throw failure(reply, path);
    await sleep(Math.min(600 * 2 ** attempt, 10000));
  }
}

function courseFromApi(raw) {
  const term = raw.term;
  return {
    id: raw.id ?? "",
    course_id: raw.courseId || raw.externalId || "",
    name: raw.name || raw.displayName || "(untitled course)",
    term: term && typeof term === "object" ? term.name ?? null : null,
    available: ["Yes", "Term"].includes(raw.availability?.available),
    term_id: raw.termId ?? null,
    term_start: null,
    term_end: null,
    last_accessed: null,
    // Blackboard's own address for the course — the one URL never constructed.
    external_url: raw.externalAccessUrl ?? null,
  };
}

/** True or false when the term has real dates, null when it cannot be told. */
export function isCurrent(course) {
  if (!course.term_start || !course.term_end) return null;
  const now = new Date();
  return course.term_start <= now && now <= course.term_end;
}

export class Client {
  constructor(origin) {
    this.origin = origin;
    this._me = null;
    this._terms = new Map();
  }

  async getJson(path, params = null) {
    return (await request({ type: "get", path: withQuery(path, params) }, path)).data;
  }

  /** Follow paging.nextPage and concatenate. nextPage carries its own query, so
   * params go on the first request only. */
  async paged(path, { limit = 500, params = null } = {}) {
    const out = [];
    const seen = new Set();
    let next = path;
    let query = { limit: 200, ...params };
    while (next && out.length < limit) {
      const data = await this.getJson(next, query);
      query = null;
      if (!Array.isArray(data?.results)) return data ? [data] : [];
      out.push(...data.results);
      seen.add(next);
      next = data.paging?.nextPage ?? null;
      if (next && seen.has(next)) break; // malformed paging: stop rather than spin
    }
    return out.slice(0, limit);
  }

  async me() {
    this._me ??= await this.getJson("/learn/api/public/v1/users/me");
    return this._me;
  }

  async userId() {
    const id = (await this.me())?.id;
    if (!id) throw new BlackboardError("Blackboard did not return a user id for the session.");
    return id;
  }

  async term(termId) {
    if (!this._terms.has(termId)) {
      this._terms.set(termId, this.getJson(`/learn/api/public/v1/terms/${termId}`)
        .catch((e) => { if (e instanceof AuthError) throw e; return null; }));
    }
    return this._terms.get(termId);
  }

  async attachTerms(courses) {
    const ids = [...new Set(courses.map((c) => c.term_id).filter(Boolean))].sort();
    if (!ids.length) return;
    const fetched = await Promise.allSettled(ids.map((id) => this.term(id)));
    const byId = new Map(ids.map((id, i) =>
      [id, fetched[i].status === "fulfilled" ? fetched[i].value : null]));
    for (const c of courses) {
      const data = byId.get(c.term_id ?? "");
      if (!data) continue;
      c.term = data.name || c.term;
      const span = data.availability?.duration ?? {};
      if (span.type === "DateRange") {
        c.term_start = parseBbTime(span.start);
        c.term_end = parseBbTime(span.end);
      }
    }
  }

  async courses({ includeUnavailable = false, currentOnly = false } = {}) {
    const uid = await this.userId();
    const memberships = await this.paged(`/learn/api/public/v1/users/${uid}/courses`,
      { params: { expand: "course" } });
    const seen = new Map();
    for (const m of memberships) {
      const raw = m.course ?? {};
      // Organisations and communities carry no coursework.
      if (!raw.id || raw.organization) continue;
      const course = courseFromApi(raw);
      if (!includeUnavailable && !course.available) continue;
      course.last_accessed = m.lastAccessed ?? null;
      seen.set(course.id, course);
    }
    let courses = [...seen.values()];
    await this.attachTerms(courses);
    // Keep anything that cannot be disproved: silently hiding a course with no
    // term dates is worse than showing one course too many.
    if (currentOnly) courses = courses.filter((c) => isCurrent(c) !== false);
    return courses.sort((a, b) => cmp(a.term ?? "", b.term ?? "") || cmp(a.name, b.name));
  }

  gradebookColumns(courseId) {
    return this.paged(`/learn/api/public/v2/courses/${courseId}/gradebook/columns`);
  }

  async gradebookCategories(courseId) {
    try {
      return await this.paged(`/learn/api/public/v1/courses/${courseId}/gradebook/categories`);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      return [];
    }
  }

  /** Every grade in one course, keyed by column id, in one request. */
  async gradebookGrades(courseId, userId) {
    try {
      const rows = await this.paged(
        `/learn/api/public/v2/courses/${courseId}/gradebook/users/${userId}`);
      return Object.fromEntries(rows.filter((r) => r.columnId).map((r) => [r.columnId, r]));
    } catch (e) {
      if (e instanceof AuthError) throw e;
      return {};
    }
  }

  /** One gradebook column: how many attempts it allows and which one counts. */
  column(courseId, columnId) {
    return this.getJson(`/learn/api/public/v2/courses/${courseId}/gradebook/columns/${columnId}`);
  }

  /** The attempts at one column. A student is only ever given their own. */
  attempts(courseId, columnId) {
    return this.paged(
      `/learn/api/public/v2/courses/${courseId}/gradebook/columns/${columnId}/attempts`);
  }

  contents(courseId, contentId = null) {
    const path = contentId
      ? `/learn/api/public/v1/courses/${courseId}/contents/${contentId}/children`
      : `/learn/api/public/v1/courses/${courseId}/contents`;
    return this.paged(path, { params: { expand: "body" } });
  }

  content(courseId, contentId) {
    return this.getJson(`/learn/api/public/v1/courses/${courseId}/contents/${contentId}`);
  }

  /** Classic attachment records. Ultra items 400 here and use inline links. */
  async attachments(courseId, contentId) {
    try {
      return await this.paged(
        `/learn/api/public/v1/courses/${courseId}/contents/${contentId}/attachments`);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      return [];
    }
  }

  announcements(courseId) {
    return this.paged(`/learn/api/public/v1/courses/${courseId}/announcements`);
  }

  /** A file's bytes, by API path or by one of Ultra's absolute file links. */
  async download(path) {
    const reply = await request({ type: "file", path }, path);
    const type = (reply.type || "").split(";")[0].trim() || "application/octet-stream";
    const blob = await (await fetch(`data:${type};base64,${reply.base64}`)).blob();
    return { blob, bytes: reply.bytes, type, disposition: reply.disposition ?? null };
  }

  /**
   * One slice of a file, for something too big to download — a lecture video.
   *
   * `end` may be null for the open-ended range a media element opens with; the
   * extension decides how much of it to answer, and says what it actually sent.
   */
  async range(path, start, end) {
    const reply = await request({ type: "range", path, start, end }, path);
    const binary = atob(reply.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return {
      buffer: bytes.buffer,
      total: reply.total ?? null,
      start: reply.start,
      end: reply.end,
      type: (reply.type || "").split(";")[0].trim(),
    };
  }
}

/** A client for whichever Blackboard the extension is connected to. */
export async function open() {
  const reply = await ask({ type: "host" });
  if (!reply?.host) throw new AuthError("Whiteboard isn't connected to a Blackboard yet.");
  return new Client(reply.host);
}
