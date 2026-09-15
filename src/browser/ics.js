// The .ics feed. The calendar grid renders this document rather than the JSON,
// so what is on screen and what an exported file puts in a calendar cannot
// disagree.

const PRODID = "-//blackboard-dashboard//Whiteboard//EN";
const UID_DOMAIN = "blackboard-dashboard.local";
// A deadline is an instant; a short block ending at it is how calendars show one.
const BLOCK_MINUTES = 30;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

/** Escape a TEXT value (RFC 5545 §3.3.11). */
const esc = (value) => (value == null ? "" : String(value))
  .replace(/\\/g, "\\\\")
  .replace(/\r\n|\r/g, "\n")
  .replace(/\n/g, "\\n")
  .replace(/,/g, "\\,")
  .replace(/;/g, "\\;");

/** Split a line into 75-octet chunks without splitting a multi-byte character. */
function fold(line) {
  const raw = new TextEncoder().encode(line);
  if (raw.length <= 75) return [line];
  const decoder = new TextDecoder();
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < raw.length) {
    let end = Math.min(start + limit, raw.length);
    while (end > start && end < raw.length && (raw[end] & 0xc0) === 0x80) end--;
    const chunk = decoder.decode(raw.subarray(start, end));
    out.push(out.length ? ` ${chunk}` : chunk);
    start = end;
    limit = 74; // a continuation line spends one octet on its leading space
  }
  return out;
}

/** A Date or ISO string as a Date; one with no offset is UTC. */
function toDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value);
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
  `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** "Fri Sep 04, 11:59 PM", in this machine's time. */
function human(d) {
  const hour = d.getHours() % 12 || 12;
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${pad(d.getDate())}, ` +
    `${pad(hour)}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

const points = (p) => String(Number(p));

function uid(item) {
  const handle = item.column_id || item.content_id || item.title || "item";
  return `bb-${String(handle).replace(/[^A-Za-z0-9._-]/g, "-")}@${UID_DOMAIN}`;
}

function event(item, now) {
  const due = toDate(item.due_utc || item.due_local);
  if (!due) return null;
  const start = new Date(due.getTime() - BLOCK_MINUTES * 60000);
  const course = item.course || "";
  const title = item.title || "(untitled assignment)";
  const summary = course ? `${course}: ${title}` : title;
  const pts = item.points_possible;
  const description = [
    item.course_name || course || null,
    `Due ${human(due)}`,
    pts ? `${points(pts)} points` : null,
    item.submitted ? "Already submitted" : null,
  ].filter(Boolean).join("\n");

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid(item)}`,
    `DTSTAMP:${now}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(due)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    "STATUS:CONFIRMED",
    // A deadline should not make the student look busy to anyone else.
    "TRANSP:TRANSPARENT",
  ];
  if (course) lines.push(`CATEGORIES:${esc(course)}`);
  // The dashboard's own grid reads these back to colour by course and link a chip.
  for (const [prop, value] of [
    ["X-BB-COURSE", course],
    ["X-BB-COURSE-NAME", item.course_name],
    ["X-BB-COURSE-ID", item.course_id],
    ["X-BB-COLUMN-ID", item.column_id],
    ["X-BB-CONTENT-ID", item.content_id],
    ["X-BB-TITLE", title],
  ]) {
    if (value) lines.push(`${prop}:${esc(value)}`);
  }
  if (pts != null) lines.push(`X-BB-POINTS:${points(pts)}`);
  lines.push(`X-BB-SUBMITTED:${item.submitted ? "TRUE" : "FALSE"}`);
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-P1D",
    `DESCRIPTION:${esc(`Due tomorrow: ${summary}`)}`,
    "END:VALARM",
    "END:VEVENT",
  );
  return lines;
}

/** Render assignments as a complete VCALENDAR document. */
export function build(items, { calname = "Coursework", description = null, now = new Date() } = {}) {
  const at = stamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calname)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  if (description) lines.push(`X-WR-CALDESC:${esc(description)}`);
  for (const item of items) {
    const ev = event(item, at);
    if (ev) lines.push(...ev);
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 wants CRLF line endings and a trailing break.
  return `${lines.flatMap(fold).join("\r\n")}\r\n`;
}
