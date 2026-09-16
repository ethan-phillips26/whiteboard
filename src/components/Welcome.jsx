import { useEffect, useRef } from "react";
import { LAYER, useTopmost } from "../lib/overlay.js";
import FileIndexer from "./FileIndexer.jsx";

/**
 * What this is, said once, the first time you ever sign in.
 *
 * A dashboard that quietly holds a term of coursework deserves one screen
 * explaining itself — where the deadlines came from, that nothing here can
 * change them back in Blackboard, and that there is a search behind Ctrl-K. It is
 * shown once per browser and never again; the record is in localStorage rather
 * than the cache, so logging out or clearing stored data does not start it over.
 *
 * It also carries the one thing worth doing on day one and never automatically:
 * reading every document in every course so their contents are searchable.
 */

const FEATURES = [
  ["Everything, in one place",
   "Every deadline, grade, announcement and handout from every course, on one " +
   "screen instead of six."],
  ["Nothing here can change Blackboard",
   "The connector only ever reads. Nothing is submitted, posted or edited on " +
   "the university's side — corrections you make live in this browser."],
  ["Search the whole term with Ctrl-K",
   "Assignments, documents, slide decks, announcements and file names, from " +
   "any screen. Or just press / when you are not typing into something."],
  ["Read handouts without downloading them",
   "Word, PowerPoint, PDFs, images and code open in the page, and lecture " +
   "recordings stream rather than download."],
  ["Grades that do the arithmetic",
   "Enter what each category is worth once and every course shows where it " +
   "actually stands, and what you need on what is left."],
];

export default function Welcome({ courses, onClose }) {
  const closeRef = useRef(null);
  const isTop = useTopmost(LAYER.overlay);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && isTop && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isTop]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal wel-modal" role="dialog" aria-modal="true"
           aria-label="Welcome to Whiteboard">
        <div className="modal-head">
          <h3>Welcome to Whiteboard</h3>
          <div className="spacer" />
          <button ref={closeRef} className="primary" onClick={onClose}>
            Get started
          </button>
        </div>

        <div className="modal-body reading">
          <div className="wel-list">
            {FEATURES.map(([title, what]) => (
              <div className="wel-item" key={title}>
                <b>{title}</b>
                <p className="note dim">{what}</p>
              </div>
            ))}
          </div>

          {/* The one thing worth offering up front: it is slow, it is opt-in,
              and day one is when it costs least to start. */}
          <div className="wel-index">
            <div className="label">Make documents searchable</div>
            <p className="note">
              Search finds a file by its name straight away. To search what is
              <em> inside</em> your handouts, they have to be read first — every
              Word document, slide deck and text file in every course, fetched
              once and kept only as words. It takes a few minutes and you can
              stop it at any point.
            </p>
            <FileIndexer courses={courses} />
          </div>
        </div>

        <div className="modal-foot">
          <span className="note dim">
            You can start this later from Settings.
          </span>
        </div>
      </div>
    </>
  );
}
