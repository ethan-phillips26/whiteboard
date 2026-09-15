import { useEffect, useMemo, useState } from "react";
import { gradePoints } from "../browser/grades.js";
import { courseSlot, dateTime, points } from "../lib/format.js";
import { Sep } from "./Sep.jsx";

/** The hero figure: how long is left, in the largest unit that is still honest. */
function countdown(due, now) {
  const ms = due - now;
  if (ms < 0) {
    const hours = -ms / 3600000;
    return hours < 24
      ? { value: Math.round(hours), unit: "hours ago", late: true }
      : { value: Math.round(hours / 24), unit: "days ago", late: true };
  }
  const hours = ms / 3600000;
  if (hours < 1) return { value: Math.max(1, Math.round(ms / 60000)), unit: "minutes left" };
  if (hours < 48) return { value: Math.round(hours), unit: "hours left" };
  return { value: Math.round(hours / 24), unit: "days left" };
}

/**
 * The ink band: the countdown to the next deadline, then the three figures worth
 * a glance. A course count and "points at stake" used to sit here too; neither
 * changed what anyone did next, so they went.
 */
export default function StatRow({ assignments, courses, standings = {}, order }) {
  // The headline figure is a countdown, so it has to move. Once a minute is
  // enough for a card that reads in hours and days, and costs nothing.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(tick), [tick]);

  const stats = useMemo(() => {
    const dated = assignments
      .filter((a) => a.due_local)
      .map((a) => ({ ...a, due: new Date(a.due_local) }))
      .sort((a, b) => a.due - b.due);

    const week = new Date(now.getTime() + 7 * 86400000);
    const upcoming = dated.filter((a) => a.due >= now);
    return {
      next: upcoming[0] ?? null,
      thisWeek: upcoming.filter((a) => a.due <= week).length,
      overdue: dated.filter((a) => a.due < now),
    };
  }, [assignments, now]);

  // Blackboard says nothing about credit hours, so every course counts the
  // same. Each course's letter comes off its own scale; its points off the
  // common 4.0 one.
  const gpa = useMemo(() => {
    const points = courses
      .map((c) => standings[c.course_id])
      .filter((s) => s?.accessible)
      .map((s) => gradePoints(s.current_letter))
      .filter((p) => p != null);
    return {
      value: points.length ? points.reduce((s, p) => s + p, 0) / points.length : null,
      courses: points.length,
    };
  }, [courses, standings]);

  const next = stats.next;
  const clock = next ? countdown(next.due, now) : null;
  const late = stats.overdue;

  return (
    <section className={"band" + (clock?.late ? " late" : "")}>
      <div className="band-hero">
        <div className="band-clock">
          <div className="label">Next deadline</div>
          <div className="band-num">
            {next ? clock.value : 0}
            <span>{next ? clock.unit : "outstanding"}</span>
          </div>
        </div>
        <div className="band-detail">
          {next ? (
            <>
              <div className="band-title" title={next.title}>{next.title}</div>
              <div className={"band-meta s" + courseSlot(next.course, order)}>
                <i className="dot" />
                <span>
                  {next.course}<Sep />{dateTime(next.due)}
                  {points(next.points_possible)
                    ? <><Sep />{points(next.points_possible)}</> : null}
                </span>
              </div>
            </>
          ) : (
            <div className="band-meta">Nothing is due in the sync window.</div>
          )}
        </div>
      </div>

      <div className="band-stats">
        <Stat label="Due this week" value={stats.thisWeek} note="next 7 days" />
        <Stat
          label="Overdue"
          value={late.length}
          note={late.length ? late[0].title : "nothing missed"}
          tone={late.length ? "bad" : "ok"}
        />
        <Stat
          label="Semester GPA"
          value={gpa.value == null ? "—" : gpa.value.toFixed(2)}
          note={gpa.value == null
            ? "nothing graded yet"
            : `${gpa.courses} ${gpa.courses === 1 ? "course" : "courses"}`}
        />
      </div>
    </section>
  );
}

function Stat({ label, value, unit, note, tone }) {
  return (
    <div className={"stat" + (tone ? ` ${tone}` : "")}>
      <div className="label">{label}</div>
      <div className="stat-num">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="stat-note" title={note}>{note}</div>
    </div>
  );
}
