import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { dateTime, relative } from "../lib/format.js";
import { LAYER, useTopmost } from "../lib/overlay.js";
import { OVERLAY, useTitle } from "../lib/title.js";
import RichText from "./RichText.jsx";
import { Sep } from "./Sep.jsx";

const pad = (n) => String(n).padStart(2, "0");
const dateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Most work is due by the end of the day it is due on, which is also where
// Blackboard's own deadlines tend to sit.
const END_OF_DAY = "23:59";

/** Escape closes it, unless something has been opened over it. */
function useEscape(onClose, level = LAYER.overlay) {
  const isTop = useTopmost(level);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && isTop && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isTop]);
}

/**
 * Title, course, when and what to know about it. Used to write an item and to
 * change one, so the two cannot drift apart.
 */
function ItemForm({ initial, courses: current, submitLabel, onSubmit, onCancel }) {
  // An item from a course that has since left the list keeps that course
  // unless it is changed, rather than being quietly unlinked by a save.
  const courses = initial.course_id && !current.some((c) => c.course_id === initial.course_id)
    ? [...current, { course_id: initial.course_id, label: initial.course,
                     title: initial.course_name }]
    : current;
  const due = initial.due ?? null;
  const [title, setTitle] = useState(initial.title ?? "");
  const [courseId, setCourseId] = useState(initial.course_id ?? courses[0]?.course_id ?? "");
  const [date, setDate] = useState(due ? dateInput(due) : "");
  const [clock, setClock] = useState(initial.time ?? END_OF_DAY);
  const [description, setDescription] = useState(initial.description ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const titleRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return setErr("Give it a title.");
    if (!date) return setErr("Give it a due date.");
    // The pickers give a wall-clock time in this machine's zone; stored as UTC.
    const when = new Date(`${date}T${clock || END_OF_DAY}`);
    if (Number.isNaN(when.getTime())) return setErr("That date can't be read.");
    const course = courses.find((c) => c.course_id === courseId);
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        title: title.trim(),
        course_id: course?.course_id ?? null,
        // Kept so the item still names its course after the course has left
        // the list, as it will at the end of term.
        course: course?.label ?? "",
        course_name: course?.title ?? null,
        due_utc: when.toISOString(),
        description: description.trim(),
      });
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <form className="own-form" onSubmit={submit}>
      <label className="field">
        <span>Title</span>
        <input ref={titleRef} type="text" value={title} maxLength={200}
               placeholder="Lab report 3, printed"
               onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Course</span>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((c) => (
            <option key={c.course_id} value={c.course_id}>
              {c.title && c.title !== c.label ? `${c.label} — ${c.title}` : c.label}
            </option>
          ))}
          <option value="">No course</option>
        </select>
      </label>
      <div className="own-when">
        <label className="field">
          <span>Due</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Time</span>
          <input type="time" value={clock} onChange={(e) => setClock(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Description</span>
        <textarea rows={5} value={description}
                  placeholder="What to bring, where to hand it in, links…"
                  onChange={(e) => setDescription(e.target.value)} />
      </label>
      {err && <p className="err">{err}</p>}
      <div className="set-actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? <><span className="spin" /> Saving</> : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

/** Write a new item onto the calendar. `day` is the date to start from, if any. */
export function AddItem({ courses, day, courseId, onSaved, onClose }) {
  useEscape(onClose);
  useTitle(["Add to calendar"], OVERLAY);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal own-modal" role="dialog" aria-modal="true"
           aria-label="Add to calendar">
        <div className="modal-head">
          <h3>Add to calendar</h3>
        </div>
        <div className="modal-body">
          <ItemForm
            initial={{ due: day ?? null, course_id: courseId }}
            courses={courses}
            submitLabel="Add"
            onSubmit={async (fields) => {
              await api.addItem(fields);
              await onSaved();
              onClose();
            }}
            onCancel={onClose}
          />
        </div>
      </div>
    </>
  );
}

/** One of the student's own items: what they wrote, and the means to change it. */
export default function OwnItemDrawer({ item, courses, onChanged, onClose }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const closeRef = useRef(null);

  useTitle([item.title, item.course], OVERLAY);
  useEscape(onClose);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const due = item.due_utc ? new Date(item.due_utc) : null;

  async function act(fn) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={item.title}>
        <div className="drawer-head">
          <div className="drawer-title">
            <h3>{item.title}</h3>
            <div className="drawer-meta">
              {item.course && <span className="course">{item.course}</span>}
              <span className="note dim">
                {due ? <>{dateTime(due)}<Sep />{relative(due)}</> : "no due date"}
              </span>
              <span className={"flag" + (item.submitted ? " ok" : "")}>
                {item.submitted ? "done" : "your item"}
              </span>
            </div>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close">Close</button>
        </div>

        <div className="drawer-body">
          {editing ? (
            <ItemForm
              initial={{ ...item, due, time: due ? timeInput(due) : null }}
              courses={courses}
              submitLabel="Save"
              onSubmit={async (fields) => {
                await api.editItem(item.own_id, fields);
                await onChanged();
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              {item.description ? (
                <pre className="instructions">
                  <RichText text={item.description} bare />
                </pre>
              ) : (
                <p className="empty">Nothing written on this item.</p>
              )}
              {err && <p className="err">{err}</p>}
              <div className="set-actions">
                <button className="primary" disabled={busy}
                        onClick={() => act(() =>
                          api.editItem(item.own_id, { done: !item.submitted }))}>
                  {item.submitted ? "Not done yet" : "Mark done"}
                </button>
                <button disabled={busy} onClick={() => setEditing(true)}>Edit</button>
                {/* Two presses rather than a browser confirm, which would stop
                    the page dead until it was answered. */}
                {confirming ? (
                  <button className="danger" disabled={busy}
                          onClick={() => act(async () => {
                            await api.removeItem(item.own_id);
                            onClose();
                          })}>
                    Delete for good
                  </button>
                ) : (
                  <button disabled={busy} onClick={() => setConfirming(true)}>Delete</button>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
