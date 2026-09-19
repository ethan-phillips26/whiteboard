import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { available as googleAvailable } from "../browser/google.js";
import FileIndexer from "./FileIndexer.jsx";
import { THEMES } from "../lib/theme.js";
import { dateTime, filesize, points } from "../lib/format.js";

const THEME_LABELS = { light: "Light", dark: "Dark" };

// The choice lives in localStorage rather than on the server: it belongs to the
// screen you are reading on, not to the account, so a phone and a desktop can
// disagree about it and both be right.

/** An <input type="datetime-local"> wants a naive local string, not an ISO one. */
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Appearance({ theme, onTheme }) {
  return (
    <section className="panel" id="appearance">
      <div className="panel-head">
        <h2>Appearance</h2>
        <span className="note dim">saved in this browser</span>
      </div>
      <div className="seg">
        {THEMES.map((t) => (
          <button
            key={t}
            className={theme === t ? "on" : ""}
            onClick={() => onTheme(t)}
          >
            {THEME_LABELS[t]}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * The Google link.
 *
 * There is nothing to switch on here: the first handout you send asks for
 * permission itself, and reading a file in the page and opening it in Google
 * stay two separate buttons wherever a file is offered. This is the way back
 * out — and it says plainly what disconnecting does not do, because the
 * documents are in the student's own Drive and stay there.
 */
function GoogleDrive() {
  // Module memory, not storage: the permission lasts as long as the tab, so
  // this is re-read rather than remembered.
  const [linked, setLinked] = useState(() => api.googleConnected());
  const [busy, setBusy] = useState(false);

  if (!googleAvailable()) return null;

  async function disconnect() {
    setBusy(true);
    try {
      await api.disconnectGoogle();
    } finally {
      setLinked(api.googleConnected());
      setBusy(false);
    }
  }

  return (
    <section className="panel" id="google">
      <div className="panel-head">
        <h2>Google Drive</h2>
      </div>
      <p className="note">
        Word, PowerPoint and Excel files can be opened in Google Docs, Slides or
        Sheets.
      </p>
      {linked && (
        <div className="set-actions">
          <button onClick={disconnect} disabled={busy}>
            {busy ? <><span className="spin" /> Disconnecting</> : "Disconnect Google"}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * What search can see inside.
 *
 * A file is findable by name as soon as its course has been read. What it
 * *says* is only searchable once something has read it — opening one in the
 * viewer does that for that file, and this does it for all of them at once.
 * Offered here as well as in the welcome, because day one is not the only day
 * someone decides they want it.
 */
function Documents({ courses }) {
  return (
    <section className="panel" id="documents">
      <div className="panel-head">
        <h2>Document search</h2>
        <span className="note dim">read once, kept as words</span>
      </div>
      <p className="note">
        Reading every Word document, slide deck and text file in every course
        makes their contents searchable, not just their names.
      </p>
      <FileIndexer courses={courses} clearable />
    </section>
  );
}

/** One decimal place, which is as fine as any syllabus states a weighting. */
const tenths = (x) => Math.round(x * 10) / 10;

// Blackboard knows which category each row sits in but not what a category is
// worth — that is in the syllabus, as prose — so the percentages are typed here,
// one per category. Until they are, the course is weighted by points, and the
// boxes start from exactly that, so saving without touching them changes
// nothing. The uncategorised rows are addressed as "".
function WeightRow({ course, standing, onSaved, showName = true }) {
  const categories = standing?.categories ?? [];
  const keyOf = (c) => c.category_id ?? "";
  const initial = useMemo(
    () => Object.fromEntries(categories.map((c) =>
      [keyOf(c), tenths(100 * (c.weight ?? c.effective_weight ?? 0))])),
    [standing] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { setDraft(initial); }, [initial]);

  const total = Object.values(draft).reduce((a, b) => a + (Number(b) || 0), 0);
  const dirty = categories.some((c) => Number(draft[keyOf(c)]) !== initial[keyOf(c)]);

  if (!categories.length) {
    return (
      <div className="set-course">
        <div className="set-course-head">
          {showName && <b>{course.label}</b>}
          <span className="note dim">
            {standing?.accessible === false
              ? "gradebook hidden by the instructor"
              : "nothing in the gradebook to weight yet"}
          </span>
        </div>
      </div>
    );
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.editWeights(course.course_id,
        Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v) || 0])));
      await onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true); setErr(null);
    try {
      await api.resetWeights(course.course_id);
      await onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="set-course">
      <div className="set-course-head">
        {showName && <b>{course.label}</b>}
        {standing?.weights_edited && <span className="flag">edited</span>}
        <span className="spacer" />
        <span className={"note " + (Math.round(total) === 100 ? "dim" : "warn-text")}>
          {total.toFixed(0)}% of 100
        </span>
      </div>
      {categories.map((c) => (
        <label className="set-weight" key={keyOf(c)}>
          <span className="set-weight-label">{c.title}</span>
          <input
            type="number" min="0" max="100" step="0.5"
            value={draft[keyOf(c)] ?? 0}
            onChange={(e) =>
              setDraft((d) => ({ ...d, [keyOf(c)]: e.target.value }))}
          />
          <span className="note dim">%</span>
        </label>
      ))}
      {err && <p className="err">{err}</p>}
      <div className="set-actions">
        <button className="primary" onClick={save} disabled={busy || !dirty}>
          {busy ? <><span className="spin" /> Saving</> : "Save"}
        </button>
        {standing?.weights_edited && (
          <button onClick={reset} disabled={busy}>Weight by points again</button>
        )}
      </div>
    </div>
  );
}

// An edit is stored apart from the fetched data and re-applied on read, so a
// sync cannot undo it, and a changed due date carries through to the calendar
// grid and the .ics feed as well as this list.
function DeadlineRow({ item, edit, onSaved, showCourse = true }) {
  const key = item.column_id ?? item.content_id;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(item.title ?? "");
  const [due, setDue] = useState(toLocalInput(item.due_local));
  const [pts, setPts] = useState(item.points_possible ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setTitle(item.title ?? "");
    setDue(toLocalInput(item.due_local));
    setPts(item.points_possible ?? "");
  }, [item]);

  const edited = !!edit;

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.editAssignment(key, {
        title: title.trim() || null,
        // The picker gives a naive local time; the server stores UTC.
        due_utc: due ? new Date(due).toISOString() : null,
        points_possible: pts === "" ? null : Number(pts),
      });
      await onSaved();
      setOpen(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function hide() {
    setBusy(true); setErr(null);
    try {
      await api.editAssignment(key, { hidden: true });
      await onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true); setErr(null);
    try {
      await api.resetAssignment(key);
      await onSaved();
      setOpen(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className={"set-item" + (open ? " open" : "")}>
      <button className="set-item-head" onClick={() => setOpen((v) => !v)}>
        <div className="set-item-id">
          <b>{item.title}</b>
          {edited && <span className="flag">edited</span>}
          {item.hidden && <span className="flag warn">hidden</span>}
          <div className="note dim">
            {showCourse ? `${item.course} · ` : ""}
            {item.due_local ? dateTime(new Date(item.due_local)) : "no due date"}
            {points(item.points_possible) ? ` · ${points(item.points_possible)}` : ""}
          </div>
        </div>
        <span className="note dim">{open ? "Close" : "Edit"}</span>
      </button>

      {open && (
        <div className="set-item-body">
          <label className="field">
            <span>Title</span>
            <input type="text" value={title}
                   onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Due</span>
            <input type="datetime-local" value={due}
                   onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="field">
            <span>Points</span>
            <input type="number" min="0" step="1" value={pts}
                   onChange={(e) => setPts(e.target.value)} />
          </label>
          {err && <p className="err">{err}</p>}
          <div className="set-actions">
            <button className="primary" onClick={save} disabled={busy}>
              {busy ? <><span className="spin" /> Saving</> : "Save"}
            </button>
            {!item.hidden && (
              <button onClick={hide} disabled={busy}>Hide from dashboard</button>
            )}
            {edited && (
              <button onClick={reset} disabled={busy}>Reset to Blackboard</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** What is worth saying about a course before you open it. */
function courseSummary(course, data) {
  const id = course.course_id;
  // The student's own items are changed where they are opened, not here: this
  // screen is for correcting what Blackboard said.
  const due = data.assignments.filter((a) => a.course_id === id && !a.own).length;
  const hidden = (data.hidden_assignments ?? [])
    .filter((a) => a.course_id === id).length;
  const standing = data.standings[id];
  const edits = data.edits?.assignments ?? {};
  const changed = [...data.assignments, ...(data.hidden_assignments ?? [])]
    .filter((a) => a.course_id === id &&
                   edits[a.column_id ?? a.content_id]).length;
  return { due, hidden, changed, standing };
}

function CourseButton({ course, data }) {
  const { due, hidden, changed, standing } = courseSummary(course, data);
  return (
    <a className="ccard set-card" href={`#/settings/${course.course_id}`}>
      <div className="ccard-head">
        <div>
          <h3>{course.label}</h3>
          <div className="code">
            {course.title && course.title !== course.label ? course.title : "\u00a0"}
          </div>
        </div>
      </div>
      <div className="set-card-meta note dim">
        <div>
          {standing?.weighted_by === "custom" ? "weighting entered" : "weighted by points"}
        </div>
        <div>
          {due} {due === 1 ? "deadline" : "deadlines"}
          {hidden ? ` · ${hidden} hidden` : ""}
        </div>
      </div>
      <div className="ccard-foot">
        {standing?.weights_edited && <span className="flag">weights edited</span>}
        {changed > 0 && <span className="flag">{changed} edited</span>}
        <span className="go" aria-hidden="true">→</span>
      </div>
    </a>
  );
}

/** Everything editable about one course, and nothing about any other. */
function CourseSettings({ course, data, onReload, onBack }) {
  const [query, setQuery] = useState("");
  const id = course.course_id;
  const edits = data.edits ?? { assignments: {}, weights: {} };
  const mine = useMemo(
    () => data.assignments.filter((a) => a.course_id === id && !a.own),
    [data.assignments, id]
  );
  const hidden = useMemo(
    () => (data.hidden_assignments ?? []).filter((a) => a.course_id === id),
    [data.hidden_assignments, id]
  );
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? mine.filter((a) => a.title.toLowerCase().includes(q)) : mine;
  }, [mine, query]);

  return (
    <>
      <header className="topbar">
        <div>
          <h1>{course.label}</h1>
          <p className="note dim">
            {course.title && course.title !== course.label
              ? course.title : "Course settings"}
          </p>
        </div>
        <div className="spacer" />
        <button onClick={onBack}>Back to settings</button>
      </header>

      <section className="panel" id="weights">
        <div className="panel-head">
          <h2>Grade weighting</h2>
        </div>
        <WeightRow course={course} standing={data.standings[id]}
                   onSaved={onReload} showName={false} />
      </section>

      <section className="panel" id="deadlines-edit">
        <div className="panel-head">
          <h2>Deadlines</h2>
          <span className="note dim">
            {mine.length} outstanding{hidden.length ? ` · ${hidden.length} hidden` : ""}
          </span>
        </div>
        {mine.length > 6 && (
          <input
            className="set-search"
            type="search"
            placeholder="Filter by title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {items.map((a) => (
          <DeadlineRow
            key={a.column_id ?? a.content_id ?? a.title}
            item={a}
            edit={edits.assignments?.[a.column_id ?? a.content_id]}
            onSaved={onReload}
            showCourse={false}
          />
        ))}
        {!items.length && (
          <p className="empty">
            {mine.length ? "Nothing matches that." : "Nothing outstanding for this course."}
          </p>
        )}

        {hidden.length > 0 && <HiddenList items={hidden} onSaved={onReload} />}
      </section>
    </>
  );
}

export default function Settings({ data, courseId, theme, onTheme, onReload,
                                   onBack, onOpenCourse, me, onLogout, loggingOut,
                                   demo = false }) {
  const course = courseId
    ? data.courses.find((c) => c.course_id === courseId)
    : null;

  if (courseId && course) {
    return (
      <CourseSettings course={course} data={data} onReload={onReload}
                      onBack={onOpenCourse} />
    );
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Settings</h1>
          <p className="note dim">
            Appearance, and corrections to what Blackboard reports.
          </p>
        </div>
        <div className="spacer" />
        {/* The tab bar is the way back on a phone. */}
        <button className="wide-only" onClick={onBack}>Back to dashboard</button>
      </header>

      {courseId && !course && (
        <p className="err banner">That course is not in this term.</p>
      )}

      <Appearance theme={theme} onTheme={onTheme} />

      <GoogleDrive />

      <Documents courses={data.courses} />

      <section className="section" id="courses">
        <div className="panel-head">
          <h2>Courses</h2>
          <span className="note dim">
            {data.courses.length} enrolled — open one to correct its weighting
            or its deadlines
          </span>
        </div>
        <div className="grid cards">
          {data.courses.map((c) => (
            <CourseButton key={c.course_id} course={c} data={data} />
          ))}
        </div>
      </section>

      <StoredData onReload={onReload} />

      <Account me={me} onLogout={onLogout} loggingOut={loggingOut} demo={demo} />
    </>
  );
}

/**
 * Who is signed in, and the way out — on a phone only.
 *
 * Everywhere else the sidebar's foot says this. A phone's header has no room for
 * it and its tab bar is for going places, so it comes here, where a person looking
 * for "log out" looks.
 */
function Account({ me, onLogout, loggingOut, demo }) {
  const name = [me?.name?.given, me?.name?.family].filter(Boolean).join(" ") ||
    me?.username || "";
  return (
    <section className="panel only-narrow" id="account">
      <div className="panel-head">
        <h2>Account</h2>
        {name && <span className="note dim">{name}</span>}
      </div>
      <button onClick={onLogout} disabled={loggingOut}>
        {loggingOut
          ? <><span className="spin" /> {demo ? "Leaving" : "Logging out"}</>
          : demo ? "Exit demo" : "Log out"}
      </button>
    </section>
  );
}

/**
 * The way back to a clean slate.
 *
 * Everything this deletes is re-fetchable — that is the whole reason it is safe
 * to offer. What it keeps is the Blackboard login, which costs an SSO round trip
 * and a Duo push to re-establish and is not data about your courses.
 *
 * The button arms before it fires. A term of corrections is worth one deliberate
 * second, and there is nothing to undo it with.
 */
function StoredData({ onReload }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);

  async function clear() {
    setBusy(true); setErr(null);
    try {
      const result = await api.resetData();
      setDone(result);
      setArmed(false);
      // The cache is empty now, so this reload is a full re-sync rather than a
      // read — the screen fills back in instead of going blank.
      await onReload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" id="stored-data">
      <div className="panel-head">
        <h2>Stored data</h2>
      </div>

      {err && <p className="err">{err}</p>}
      {done && !armed && (
        <p className="note">
          Cleared {done.cache_entries} cached {done.cache_entries === 1 ? "entry" : "entries"}
          {done.files > 0 && <> and {done.files} {done.files === 1 ? "file" : "files"}</>}
          {done.bytes > 0 && <> — {filesize(done.bytes)} freed</>}.
        </p>
      )}

      <div className="set-actions">
        {armed ? (
          <>
            <button className="danger" onClick={clear} disabled={busy}>
              {busy ? <><span className="spin" /> Clearing</> : "Delete it all"}
            </button>
            <button onClick={() => setArmed(false)} disabled={busy}>Cancel</button>
            <span className="note dim">This cannot be undone.</span>
          </>
        ) : (
          <button onClick={() => { setArmed(true); setDone(null); }}>
            Clear stored data
          </button>
        )}
      </div>
    </section>
  );
}

function HiddenList({ items, onSaved }) {
  return (
    <div className="set-hidden">
      <div className="label">Hidden</div>
      {items.map((item) => {
        const key = item.column_id ?? item.content_id;
        return (
          <div className="set-hidden-row" key={key}>
            <span className="note">{item.title}</span>
            <span className="spacer" />
            <button onClick={async () => {
              await api.resetAssignment(key);
              await onSaved();
            }}>Show again</button>
          </div>
        );
      })}
    </div>
  );
}
