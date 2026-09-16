import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { extension, save } from "../lib/download.js";
import { dateTime, filesize, points, relative } from "../lib/format.js";
import { LAYER, useTopmost } from "../lib/overlay.js";
import { OVERLAY, useTitle } from "../lib/title.js";
import { canView } from "../lib/viewer.js";
import BbLink from "./BbLink.jsx";
import DocumentViewer from "./DocumentViewer.jsx";
import GoogleButton from "./GoogleButton.jsx";
import RichText from "./RichText.jsx";
import { Sep } from "./Sep.jsx";
import Submissions from "./Submissions.jsx";

/**
 * The downloaded copy of one attachment. It is found by the name Blackboard gave
 * it or the name it was saved under; its position in the list is trusted only when
 * nothing failed, because after a failure position N is some other file — and
 * handing over the wrong handout is worse than saying this one did not come.
 */
export function savedFile(result, filename, index) {
  const rows = result?.downloaded ?? [];
  return rows.find((f) => f.filename === filename || f.original === filename)
    ?? (result?.failed?.length ? undefined : rows[index]);
}

/** Why a file did not arrive, as specifically as the fetch said. */
export function whyNotFetched(result, filename) {
  const failed = result?.failed?.find((f) => f.filename === filename);
  return failed?.error
    ? `Couldn't fetch ${filename}: ${failed.error}`
    : `Blackboard would not give up ${filename}.`;
}

/**
 * The assignment behind a deadline: what it actually says, and its handouts.
 *
 * `target` is whatever the calendar or the deadline list knows — course, title,
 * due date — so the drawer has something real to show from the first frame,
 * before the instructions arrive.
 */
export default function AssignmentDrawer({ target, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [opening, setOpening] = useState(null);
  const closeRef = useRef(null);

  const { courseId, contentId } = target;

  // The drawer covers the screen that opened it, so while it is up it is what
  // the tab should name — a bookmark or a pinned tab taken here says which
  // assignment was being read, not merely which course.
  useTitle([detail?.title ?? target.title, target.course], OVERLAY);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Escape belongs to whatever is on top. This, the document reader it opens and
  // the search palette all listen on the window, and the one that registered
  // first is not the one in front, so each stands down unless it is topmost.
  const isTop = useTopmost(LAYER.overlay);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && isTop) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isTop]);

  useEffect(() => {
    // A manually created gradebook column has no content item behind it, so
    // there are no instructions to fetch and nothing to download.
    if (!contentId || !courseId) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    setFiles(null);
    api
      .assignment(courseId, contentId)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [courseId, contentId]);

  /**
   * Bring this item's files down if they are not here yet, and hand back the one
   * that was asked for. One call fetches every attachment, so the second row you
   * press is served from what the first already got rather than from Blackboard
   * again.
   */
  async function fetched(filename, index) {
    const result = files ?? await api.fetchFiles(courseId, contentId);
    if (!files) setFiles(result);
    const row = savedFile(result, filename, index);
    // A streamed row carries no url on purpose: it was never fetched, and that
    // is not the same thing as Blackboard refusing it.
    if (!row || (!row.url && !row.streamable)) {
      throw new Error(whyNotFetched(result, filename));
    }
    return row;
  }

  async function download(filename, index) {
    setDownloading(filename);
    setFileError(null);
    try {
      const row = await fetched(filename, index);
      if (row.streamable) {
        throw new Error(
          `${row.filename} is streamed rather than downloaded — press View to watch it, ` +
          "or open it in Blackboard to save a copy.");
      }
      save(row.url, row.filename);
    } catch (e) {
      setFileError(e.message);
    } finally {
      setDownloading(null);
    }
  }

  /** A file has to be here before it can be read, so opening it fetches it. */
  async function view(filename, index) {
    setOpening(filename);
    setFileError(null);
    try {
      // `origin` is what lets search remember the text once it has been drawn.
      // A file returned with feedback carries none: it belongs to an attempt
      // rather than to the item, and filing it under the item would find the
      // wrong thing later.
      const row = await fetched(filename, index);
      setViewing({ ...row, origin: { courseId, contentId } });
    } catch (e) {
      setFileError(e.message);
    } finally {
      setOpening(null);
    }
  }

  const attachments = detail?.attachments ?? [];

  // Every opener that knows the gradebook column passes it; the assignment
  // itself names it too, for one that did not.
  const columnId = target.columnId ?? detail?.grade_column_id ?? null;
  const submissions = courseId && columnId ? (
    <Submissions courseId={courseId} columnId={columnId} possible={target.points}
                 onView={setViewing} />
  ) : null;
  // Opened from a grade, the submission is what was asked for, so it leads
  // rather than waiting under the instructions.
  const first = target.focus === "submissions";

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true"
             aria-label={target.title || "Assignment"}>
        <div className="drawer-head">
          <div className="drawer-title">
            <h3>{detail?.title || target.title}</h3>
            <div className="drawer-meta">
              {target.course && <span className="course">{target.course}</span>}
              <span className="note dim">
                {target.due
                  ? <>{dateTime(target.due)}<Sep />{relative(target.due)}</>
                  : "no due date"}
                {points(target.points) ? <><Sep />{points(target.points)}</> : null}
              </span>
            </div>
          </div>
          {detail?.web_url && <BbLink href={detail.web_url} className="btn bblink" />}
          <button ref={closeRef} onClick={onClose} aria-label="Close">Close</button>
        </div>

        <div className="drawer-body">
          {first && submissions}

          {!contentId && (
            <p className="note">
              This is a manually created gradebook column — there is no content item
              behind it in Blackboard, so it has no instructions or files to fetch.
              Look for the material under the course's Materials tab.
            </p>
          )}

          {loading && <p className="empty"><span className="spin" /> Reading the assignment…</p>}
          {error && <p className="err">{error}</p>}

          {detail && (
            <>
              {detail.instructions?.trim() ? (
                <pre className="instructions">
                  <RichText text={detail.instructions.trim()} />
                </pre>
              ) : (
                <p className="empty">There is nothing written on this item.</p>
              )}

              <div className="drawer-files">
                <div className="panel-head">
                  <h2>Files</h2>
                  <span className="note dim">
                    {attachments.length || "no"} attached
                  </span>
                </div>

                {attachments.map((a, i) => {
                  const saved = savedFile(files, a.filename, i);
                  // Once downloaded the size is measured rather than claimed.
                  const size = filesize(saved?.bytes ?? a.bytes);
                  return (
                    <div className="filerow" key={a.filename ?? i}>
                      <span className="fileext" aria-hidden="true">
                        {extension(a.filename)}
                      </span>
                      <span className="fileid">
                        {canView(a.filename) ? (
                          <button
                            className="fn linkish"
                            title={`Read ${a.filename} here`}
                            onClick={() => view(a.filename, i)}
                          >
                            {a.filename}
                          </button>
                        ) : (
                          <span className="fn" title={a.filename}>{a.filename}</span>
                        )}
                        {size && <span className="fsize">{size}</span>}
                      </span>
                      <span className="filerow-actions">
                        {canView(a.filename) && (
                          <button
                            className="primary"
                            onClick={() => view(a.filename, i)}
                            disabled={opening === a.filename}
                          >
                            {opening === a.filename
                              ? <><span className="spin" /> Opening</>
                              : "View"}
                          </button>
                        )}
                        <GoogleButton
                          filename={a.filename}
                          getFile={() => fetched(a.filename, i)}
                          onError={setFileError}
                        />
                        <button
                          onClick={() => download(a.filename, i)}
                          disabled={downloading === a.filename}
                        >
                          {downloading === a.filename
                            ? <><span className="spin" /> Fetching</>
                            : "Download"}
                        </button>
                      </span>
                    </div>
                  );
                })}

                {fileError && <p className="err">{fileError}</p>}
                {/* The reason, not just the name: it is usually the fix. */}
                {files?.failed
                  ?.filter((f) => !fileError?.includes(f.filename))
                  .map((f) => (
                    <p className="err" key={f.filename}>
                      Couldn't fetch {f.filename}: {f.error}
                    </p>
                  ))}
              </div>
            </>
          )}

          {!first && submissions}
        </div>
      </aside>

      {viewing && (
        <DocumentViewer file={viewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}
