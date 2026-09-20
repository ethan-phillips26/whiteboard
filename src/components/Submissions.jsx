import { useEffect, useState } from "react";
import { api } from "../api.js";
import { extension, save } from "../lib/download.js";
import { dateTime } from "../lib/format.js";
import { canView } from "../lib/viewer.js";
import GoogleButton from "./GoogleButton.jsx";
import RichText from "./RichText.jsx";
import { Sep } from "./Sep.jsx";

const when = (iso) => (iso ? dateTime(new Date(iso)) : null);

function Fact({ term, value }) {
  return value ? <div><dt>{term}</dt><dd>{value}</dd></div> : null;
}

function Part({ label, text, className = "", children }) {
  return (
    <div className={"attempt-part " + className}>
      <span className="label">{label}</span>
      {text && <pre className="instructions"><RichText text={text} /></pre>}
      {children}
    </div>
  );
}

/** Files from a submission, drawn like a handout's: the name reads it here. */
function Files({ label, list, owner, busy, onTake, onGet, onError }) {
  if (!list?.length) return null;
  return (
    <div className="attempt-files">
      {label && <span className="label">{label}</span>}
      {list.map((f) => {
        const key = `${owner}/${f.id ?? f.url}`;
        const viewable = canView(f.name);
        return (
          <div className="filerow" key={key}>
            <span className="fileext" aria-hidden="true">{extension(f.name)}</span>
            <span className="fileid">
              {viewable ? (
                <button className="fn linkish" title={`Read ${f.name} here`}
                        onClick={() => onTake(owner, f, true)}>
                  {f.name}
                </button>
              ) : (
                <span className="fn" title={f.name}>{f.name}</span>
              )}
            </span>
            <span className="filerow-actions">
              {viewable && (
                <button className="primary" onClick={() => onTake(owner, f, true)}
                        disabled={busy === key}>
                  {busy === key ? <><span className="spin" /> Opening</> : "View"}
                </button>
              )}
              <GoogleButton filename={f.name} getFile={() => onGet(owner, f)}
                            onError={onError} />
              <button onClick={() => onTake(owner, f, false)} disabled={busy === key}>
                {busy === key ? <><span className="spin" /> Fetching</> : "Download"}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * What you have handed in for one gradebook column: every attempt, its grade,
 * what the instructor said, and any file returned with it. It shows a
 * submission; it never makes one.
 */
export default function Submissions({ courseId, columnId, possible, onView }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [asked, setAsked] = useState(0);
  const [busy, setBusy] = useState(null);
  const [fileError, setFileError] = useState(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    // The first read may come from the cache; "Refresh" goes to Blackboard.
    api.submissions(courseId, columnId, asked > 0)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [courseId, columnId, asked]);

  /** The same file, fetched but not acted on — what the Google button uploads. */
  const get = (owner, file) => api.attemptFile(courseId, owner, file);

  /** Fetch one file and read it here or save it. `owner` is the attempt it came
   * with, or "grade" for a file returned with the grade's own feedback. */
  async function take(owner, file, open) {
    setBusy(`${owner}/${file.id ?? file.url}`);
    setFileError(null);
    try {
      const got = await api.attemptFile(courseId, owner, file);
      if (open) onView(got);
      else save(got.url, got.filename);
    } catch (e) {
      setFileError(`Couldn't fetch ${file.name}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  const column = data?.column ?? {};
  const outOf = column.possible ?? possible ?? null;
  const attempts = data?.attempts ?? [];
  const grade = data?.grade ?? null;
  // Feedback left on the grade rather than an attempt — unless an attempt
  // already says the same thing, which is how some schools store it.
  const gradeFeedback = grade?.feedback && !attempts.some((a) => a.feedback === grade.feedback)
    ? grade.feedback : null;
  const gradeFiles = grade?.feedback_files ?? [];

  return (
    <section className="drawer-section" id="submissions">
      <div className="panel-head">
        <h2>Submissions</h2>
        {data && !data.closed && (
          <span className="note dim">
            {attempts.length
              ? `${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"}`
              : "none yet"}
            {column.attempts_allowed ? <><Sep />{column.attempts_allowed} allowed</> : null}
            {column.scoring && attempts.length > 1
              ? <><Sep />graded on {column.scoring}</> : null}
          </span>
        )}
        <div className="spacer" />
        {data && (
          <button onClick={() => setAsked((n) => n + 1)} disabled={loading}>
            {loading ? <><span className="spin" /> Checking</> : "Refresh"}
          </button>
        )}
      </div>

      {loading && !data && (
        <p className="empty"><span className="spin" /> Reading your submissions…</p>
      )}
      {error && <p className="err">{error}</p>}
      {data?.closed && (
        <p className="notice">
          Your school doesn't let students read submissions through Blackboard's API,
          so they can only be seen in Blackboard itself.
        </p>
      )}

      {(gradeFeedback || gradeFiles.length > 0) && (
        <Part label={attempts.length ? "Instructor feedback on the grade" : "Instructor feedback"}
              text={gradeFeedback} className="feedback">
          <Files label="Files from your instructor" list={gradeFiles} owner="grade"
                 busy={busy} onTake={take} onGet={get} onError={setFileError} />
        </Part>
      )}

      {data && !data.closed && !attempts.length && (
        <p className="empty">
          {grade && (grade.score != null || grade.grade_text)
            ? "Nothing was handed in here — it was graded directly."
            : "You haven't submitted anything for this."}
        </p>
      )}

      {attempts.map((a, i) => (
        <article className="attempt" key={a.id ?? i}>
          <div className="attempt-head">
            <b>Attempt {i + 1}</b>
            <span className={"flag" + (a.tone ? ` ${a.tone}` : "")}>{a.status_label}</span>
            {a.group && <span className="flag">group</span>}
            <span className="attempt-grade">
              {a.exempt ? "exempt"
                : a.score != null
                  ? <>{a.score}{outOf != null && <small> / {outOf}</small>}</>
                  : a.grade_text ?? <small>not graded</small>}
            </span>
          </div>

          <dl className="facts attempt-facts">
            <Fact term="Submitted" value={when(a.submitted)} />
            <Fact term="Started"
                  value={a.started !== a.submitted ? when(a.started) : null} />
            <Fact term="Last changed"
                  value={a.modified !== a.submitted ? when(a.modified) : null} />
          </dl>

          {(a.feedback || a.feedback_files.length > 0) && (
            <Part label="Instructor feedback" text={a.feedback} className="feedback">
              <Files label="Files from your instructor" list={a.feedback_files} owner={a.id}
                     busy={busy} onTake={take} onGet={get} onError={setFileError} />
            </Part>
          )}
          {!a.feedback && !a.feedback_files.length && a.score != null && (
            <p className="note dim attempt-part">No written feedback on this attempt.</p>
          )}
          {a.submission && <Part label="Your submission" text={a.submission} />}
          {a.comments && <Part label="Your comments" text={a.comments} />}
        </article>
      ))}

      {fileError && <p className="err">{fileError}</p>}
    </section>
  );
}
