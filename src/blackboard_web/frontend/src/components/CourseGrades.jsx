import { href } from "../lib/route.js";
import GradeCalculator from "./GradeCalculator.jsx";

/**
 * Where the course's grade actually comes from: the weighting, the arithmetic,
 * and every row that feeds it.
 *
 * Blackboard knows which category each row sits in but not what a category is
 * worth — that is in the syllabus, as prose — so until percentages are entered
 * in this course's settings the grade is weighted by points, the same total
 * Blackboard's own gradebook shows.
 */
export default function CourseGrades({ course, standing }) {
  const weighted = standing?.weighted_by === "custom";
  // Once any category has a percentage, one left without counts for nothing,
  // and that is worth saying rather than leaving to be noticed.
  const uncounted = weighted
    ? standing.categories.filter((c) => c.weight == null).map((c) => c.title)
    : [];
  const settings = `${href.settings}/${encodeURIComponent(course.course_id)}`;

  return (
    <>
      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Breakdown</h2>
            <span className="note dim">
              {weighted ? "weighted by your percentages" : "weighted by points"}
            </span>
            <div className="spacer" />
            <a className="btn" href={settings}>
              {weighted ? "Edit weighting" : "Set weighting"}
            </a>
          </div>

          {standing.categories.map((c) => (
            <div className="catrow" key={c.category_id ?? c.title}>
              <span className="nm">{c.title}</span>
              <span className="w">
                {weighted
                  ? c.weight != null ? `${Math.round(c.weight * 100)}%` : "—"
                  : `${Math.round(c.effective_weight * 100)}%*`}
              </span>
              <span className="bar">
                <i style={{ width: `${Math.max(0, Math.min(100, c.pct ?? 0))}%` }} />
              </span>
              <span className="w score">
                {c.pct === null ? "—" : `${c.pct}%`}
              </span>
            </div>
          ))}

          {!weighted && (
            <p className="note dim foot-note">
              * weighted by points. Enter the syllabus's percentages in{" "}
              <a className="link" href={settings}>this course's settings</a> to
              weight it the way your instructor grades.
            </p>
          )}

          {uncounted.length > 0 && (
            <p className="note dim foot-note">
              Not counted, because they have no percentage: {uncounted.join(", ")}.
            </p>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>What do I need?</h2></div>
          <GradeCalculator courseId={course.course_id} standing={standing} />
        </section>
      </div>

      {standing.categories.some((c) => c.columns?.length) && (
        <section className="panel">
          <div className="panel-head"><h2>Items</h2></div>
          <table className="items">
            <tbody>
              {standing.categories.flatMap((c) =>
                (c.columns ?? []).map((col) => (
                  <tr key={col.column_id}>
                    <td className="it-name">{col.name}</td>
                    <td className="it-cat"><span className="course">{c.title}</span></td>
                    <td className="it-score">
                      {col.graded ? `${col.score} / ${col.possible}` : `— / ${col.possible}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
