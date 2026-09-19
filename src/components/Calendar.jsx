import { useEffect, useMemo, useRef, useState } from "react";
import {
  MONTHS, WEEKDAYS, courseOrder, courseSlot, dayKey, longDate, monthGrid,
  points, relative, sameDay, time,
} from "../lib/format.js";
import { Sep } from "./Sep.jsx";

const MAX_CHIPS = 3;

// Whether finished work is drawn. A preference of this screen, like the theme,
// so it is kept in the browser rather than the cache logging out empties.
const SHOW_DONE = "calendar-show-done";

function storedShowDone() {
  try {
    return localStorage.getItem(SHOW_DONE) !== "false";
  } catch {
    return true;
  }
}

/** How many of a day's events are still to do. */
const todo = (list) => (list ?? []).filter((e) => !e.submitted).length;

export default function Calendar({ events, loading, error, onReload,
                                   onOpenAssignment, onAdd, order }) {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selected, setSelected] = useState(null);
  const [only, setOnly] = useState(null);
  const [showDone, setShowDone] = useState(storedShowDone);

  function toggleDone() {
    const next = !showDone;
    setShowDone(next);
    try {
      localStorage.setItem(SHOW_DONE, String(next));
    } catch {
      // Storage blocked: the choice holds until the page is reloaded.
    }
  }
  const jumped = useRef(false);
  const closeRef = useRef(null);

  // A day opens as a modal, so it has to behave like one: Escape closes it, and
  // focus moves into it rather than being left behind on the grid.
  useEffect(() => {
    if (!selected) return;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // Open on the month that actually has work in it. Only once — after that the
  // month is the reader's to steer.
  useEffect(() => {
    if (jumped.current || !events.length) return;
    jumped.current = true;
    const next = events.find((e) => e.due >= today) ?? events[0];
    if (next.due.getMonth() !== today.getMonth() ||
        next.due.getFullYear() !== today.getFullYear()) {
      setMonth(new Date(next.due.getFullYear(), next.due.getMonth(), 1));
    }
  }, [events, today]);

  // The legend can only name courses that actually have work in the feed, but
  // their colours come from the app-wide order so a course is the same colour
  // here as it is in the sidebar and the deadline list.
  const present = useMemo(
    () => courseOrder(events.map((e) => e.course)),
    [events]
  );

  const visible = useMemo(
    () => events.filter((e) =>
      (!only || e.course === only) && (showDone || !e.submitted)),
    [events, only, showDone]
  );
  const anyDone = useMemo(() => events.some((e) => e.submitted), [events]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of visible) {
      const key = dayKey(e.due);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    // What is still to do comes first, so it is what the cell's few chips show.
    for (const list of map.values()) {
      list.sort((a, b) => a.submitted - b.submitted || a.due - b.due);
    }
    return map;
  }, [visible]);

  const cells = useMemo(() => monthGrid(month), [month]);
  const monthCount = cells.reduce(
    (n, c) => n + (c.inMonth ? todo(byDay.get(c.key)) : 0), 0
  );
  const selectedEvents = selected ? byDay.get(selected) ?? [] : [];

  function shift(n) {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
    setSelected(null);
  }

  function goToday() {
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(dayKey(today));
  }

  return (
    <section className="cal" id="calendar">
      <div className="sheet-head">
        <h2>
          {MONTHS[month.getMonth()]} <span className="dim">{month.getFullYear()}</span>
        </h2>
        <span className="sheet-count">
          {loading
            ? "reading calendar…"
            : `${monthCount} due ${
                sameDay(month, new Date(today.getFullYear(), today.getMonth(), 1))
                  ? "this month" : `in ${MONTHS[month.getMonth()]}`}`}
        </span>
        <div className="spacer" />
        <button className="cal-add" onClick={() => onAdd(null)}
                title="Add something Blackboard doesn't know about">
          + Add
        </button>
        <div className="joined">
          <button onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <button onClick={goToday}>Today</button>
          <button onClick={() => shift(1)} aria-label="Next month">›</button>
        </div>
      </div>

      {error && (
        <p className="err">
          {error} <button onClick={onReload}>Retry</button>
        </p>
      )}

      <div className="cal-dow" aria-hidden="true">
        {WEEKDAYS.map((d) => <span key={d} className="label">{d}</span>)}
      </div>

      <div className="cal-grid">
        {cells.map((cell) => {
          const list = byDay.get(cell.key) ?? [];
          const left = todo(list);
          const done = list.length - left;
          // A day of finished work is not a day with something due.
          const summary = left ? `${left} due` : done ? `${done} done` : "nothing due";
          const isToday = sameDay(cell.date, today);
          const className =
            "cal-cell" +
            (cell.inMonth ? "" : " out") +
            (isToday ? " today" : "") +
            (selected === cell.key ? " sel" : "");
          // A day is one target. The chips are a preview of what is in it, not
          // controls of their own — picking one assignment out of a 60px cell
          // was a small target next to a large one that did something else, and
          // the day it opens lists the same assignments at a size you can read.
          // With nothing interactive inside it, the cell can be the button — on
          // an empty day too, since opening a day is also how something is
          // added to it.
          const chips = (
            <>
              <div className="cal-num">{cell.date.getDate()}</div>
              {list.slice(0, MAX_CHIPS).map((e) => (
                <span
                  key={e.uid}
                  className={"chip s" + courseSlot(e.course, order) +
                             (e.submitted ? " done" : e.due < today ? " past" : "")}
                  title={`${e.summary}\n${time(e.due)}${
                    e.points ? ` · ${points(e.points)}` : ""}${
                    e.submitted ? ` · ${e.ownId ? "done" : "submitted"}` : ""}`}
                >
                  <span className="chip-t">{e.title || e.summary}</span>
                </span>
              ))}
              {list.length > MAX_CHIPS && (
                <span className="cal-more">+{list.length - MAX_CHIPS} more</span>
              )}
              {/* Narrow screens have no room for the chips; a count keeps the
                  day legible without leaving colour as the only signal. */}
              {list.length > 0 && (
                // "1 done" does not fit a phone's cell; a tick does, and the
                // day's label still says it in words.
                <span className={"cal-count" + (left ? "" : " done")}>
                  {left ? summary : `${done} ✓`}
                </span>
              )}
            </>
          );

          return (
            <button
              key={cell.key}
              type="button"
              className={className}
              aria-label={`${longDate(cell.date)} — ${summary}`}
              onClick={() => setSelected(cell.key)}
            >
              {chips}
            </button>
          );
        })}
      </div>

      {present.length > 0 && (
        <div className="legend">
          {present.map((name) => (
            <button
              key={name}
              className={"lg s" + courseSlot(name, order) + (only === name ? " on" : "")}
              aria-pressed={only === name}
              onClick={() => setOnly((cur) => (cur === name ? null : name))}
            >
              <i className="dot" />
              <span className="lg-name">{name}</span>
            </button>
          ))}
          {only && (
            <button className="linkish" onClick={() => setOnly(null)}>
              Show all courses
            </button>
          )}
          {anyDone && (
            // Says what pressing it does: a pressed-looking chip beside the
            // course filters left it unclear which state was which.
            <button className="lg lg-done" onClick={toggleDone}
                    title="Submitted assignments and items marked done">
              {showDone ? "Hide completed" : "Show completed"}
            </button>
          )}
        </div>
      )}

      {selected && (
        <>
          <div className="scrim" onClick={() => setSelected(null)} />
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={longDate(new Date(`${selected}T12:00:00`))}
          >
            <div className="modal-head">
              <h3>{longDate(new Date(`${selected}T12:00:00`))}</h3>
              <div className="spacer" />
              <button ref={closeRef} onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="modal-body">
          {!selectedEvents.length && <p className="empty">Nothing due.</p>}
          {selectedEvents.map((e) => (
            <button
              key={e.uid}
              className={"detail s" + courseSlot(e.course, order) +
                         (e.submitted ? " done" : "")}
              onClick={() => { setSelected(null); onOpenAssignment(e); }}
            >
              <div className="detail-head">
                <i className="dot" />
                <b>{e.title || e.summary}</b>
                {e.ownId && <span className="flag">yours</span>}
                <span className="course">{e.course}</span>
              </div>
              <div className="note dim">
                {/* Handed-in work is not overdue, however long ago it was due. */}
                Due {time(e.due)}{e.submitted ? null : <><Sep />{relative(e.due)}</>}
                {e.points ? <><Sep />{points(e.points)}</> : null}
                {e.submitted ? <><Sep />{e.ownId ? "done" : "submitted"}</> : null}
              </div>
              {e.courseName && e.courseName !== e.course && (
                <div className="note dim">{e.courseName}</div>
              )}
            </button>
          ))}
            </div>
            <div className="modal-foot">
              <button onClick={() => {
                const day = new Date(`${selected}T12:00:00`);
                // Closed first: the day's modal answers Escape without asking
                // what is over it, so it cannot stay up under the form.
                setSelected(null);
                onAdd(day);
              }}>
                + Add to this day
              </button>
            </div>
          </div>
        </>
      )}

    </section>
  );
}
