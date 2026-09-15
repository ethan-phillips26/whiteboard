import { courseSlot, dateTime, points, relative } from "../lib/format.js";
import { Sep } from "./Sep.jsx";

/**
 * Everything outstanding, soonest first.
 *
 * The list is never cut short. Beside the pinned month it scrolls inside its own
 * rail; on a window too small for that layout the page scrolls and the list
 * runs its full length. Either way there is nothing to press to see the rest.
 */
export default function DueList({ assignments, firstSeen, onOpenAssignment, order }) {
  // Anything first seen in the last day is worth marking as new.
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const now = new Date();

  return (
    <section className="rail" id="deadlines">
      <div className="sheet-head">
        <h2>Deadlines</h2>
        {assignments.length > 0 && (
          <span className="sheet-count">{assignments.length} outstanding</span>
        )}
      </div>

      {!assignments.length ? (
        <p className="empty">Nothing outstanding in the next 60 days.</p>
      ) : (
        <div className="rail-list">
          {assignments.map((a) => {
            const seen = firstSeen?.[a.column_id ?? a.content_id];
            const isNew = seen && new Date(seen).getTime() > cutoff;
            const due = a.due_local ? new Date(a.due_local) : null;
            const overdue = due && due < now;
            const urgent = (a.days_until ?? 99) <= 3;
            const pts = points(a.points_possible);
            return (
              <button
                className={"entry s" + courseSlot(a.course, order)}
                key={a.column_id ?? a.content_id ?? a.title}
                onClick={() =>
                  onOpenAssignment({
                    courseId: a.course_id, contentId: a.content_id, columnId: a.column_id,
                    title: a.title, course: a.course, points: a.points_possible,
                    due,
                  })
                }
              >
                <span className="entry-main">
                  <span className="entry-title">
                    <b title={a.title}>{a.title}</b>
                    {isNew && <span className="badge-new">new</span>}
                  </span>
                  <span className="entry-meta">
                    {a.course}<Sep />{due ? dateTime(due) : "no due date"}
                    {pts ? <><Sep />{pts}</> : null}
                  </span>
                </span>
                <span className={"when " + (overdue ? "bad" : urgent ? "soon" : "later")}>
                  {relative(due, now)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
