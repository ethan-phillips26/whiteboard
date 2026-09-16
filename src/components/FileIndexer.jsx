import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";

/**
 * Read every document in every course, so search covers what they say.
 *
 * Search finds a handout by its name the moment its course has been read, but
 * what is *inside* it only becomes searchable once something has read it — which
 * normally means you opening it. This does that deliberately, for the whole
 * term: each file is fetched, read for its text, and dropped again. What is kept
 * is the words, which is kilobytes; the files themselves are not.
 *
 * It is the most expensive thing the app can do, so it is never automatic, it
 * says what it is about to cost, it can be stopped half way, and stopping keeps
 * everything read so far. Running it again picks up where it left off.
 *
 * The same control appears in the welcome and in Settings, so it is one
 * component rather than two that drift.
 */
export default function FileIndexer({ courses, clearable = false }) {
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState(null);
  // A ref rather than state: the loop reads it between files, and it must see
  // the press immediately rather than on the next render.
  const stopped = useRef(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.indexStatus(courses));
    } catch {
      // A count is a nicety; failing to take it is not worth an error on screen.
    }
  }, [courses]);

  useEffect(() => {
    load();
  }, [load]);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setCleared(null);
    stopped.current = false;
    try {
      setResult(await api.indexFiles(courses, {
        onProgress: setProgress,
        shouldStop: () => stopped.current,
      }));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function forget() {
    setError(null);
    setResult(null);
    try {
      setCleared(await api.clearFileIndex());
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const left = status ? Math.max(0, status.readable - status.indexed) : null;
  const pct = progress?.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div className="idx">
      {busy ? (
        <>
          {/* The app's own meter, given the width of what it reports on. */}
          <div className="bar idx-bar" role="progressbar" aria-valuenow={pct}
               aria-valuemin={0} aria-valuemax={100}
               aria-label="Reading documents">
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="note dim idx-now">
            {progress?.total
              ? <>Read {progress.done} of {progress.total}</>
              : "Working out what there is…"}
            {progress?.filename && <> · {progress.filename}</>}
            {progress?.course && <> · {progress.course}</>}
          </p>
          <div className="set-actions">
            <button onClick={() => { stopped.current = true; }}>
              Stop
            </button>
            <span className="note dim">
              Everything read so far is kept.
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="note dim idx-sum">
            {status
              ? <>
                  {status.readable} {status.readable === 1 ? "document" : "documents"} can
                  be read here
                  {status.indexed > 0 && <> · {status.indexed} already read</>}
                  {status.unread > 0 && (
                    <> · {status.unread} {status.unread === 1 ? "course" : "courses"} not
                       opened yet, and will be read first</>
                  )}
                </>
              : <><span className="spin" /> Counting…</>}
          </p>
          <div className="set-actions">
            <button className="primary" onClick={run} disabled={!courses?.length}>
              {left === 0 && status?.unread === 0
                ? "Read them again"
                : left > 0 ? `Read ${left} ${left === 1 ? "document" : "documents"}`
                : "Read every document"}
            </button>
            {clearable && status?.indexed > 0 && (
              <button onClick={forget}>Forget what was read</button>
            )}
          </div>
        </>
      )}

      {error && <p className="err">{error}</p>}
      {cleared != null && (
        <p className="note">
          Forgot {cleared} {cleared === 1 ? "document" : "documents"}. Their names
          are still searchable.
        </p>
      )}
      {result && (
        <p className="note">
          {result.stopped ? "Stopped. " : "Done. "}
          Read {result.indexed}
          {result.skipped > 0 && <>, skipped {result.skipped}</>}
          {result.failed > 0 && <>, {result.failed} could not be fetched</>}.
        </p>
      )}
      {result?.failures?.length > 0 && (
        <div className="idx-fails">
          {result.failures.map((f, i) => (
            <p className="note dim" key={`${f.filename}-${i}`}>
              {f.filename}: {f.error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
