import { useEffect, useRef } from "react";
import { LAYER, useTopmost } from "../lib/overlay.js";

/**
 * The Claude tab, announced once to people who already use Whiteboard.
 *
 * It is opt-in and needs things on the person's own computer, so it is offered
 * rather than switched on: "Set it up" turns the tab on and goes there, where the
 * connection steps live. The copy says what it reads and that nothing leaves the
 * machine for a Whiteboard server, because that is the first thing anyone asks.
 */

const THINGS = [
  ["Answers from your courses",
   "Ask what is due, what the syllabus says about late work, or where you stand. " +
   "It searches assignments, announcements, grades and the text inside your documents, " +
   "slides and PDFs."],
  ["Shows what it read",
   "Each answer lists the files and pages behind it. Click one to open it beside the chat."],
  ["Study guides and quizzes",
   "Ask for a study guide and get a Word file. Quizzes are checked instantly, and " +
   "short answers are graded by Claude."],
];

export default function WhatsNew({ onClose, onSetUp }) {
  const setupRef = useRef(null);
  const isTop = useTopmost(LAYER.overlay);

  useEffect(() => {
    setupRef.current?.focus();
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
           aria-label="New in Whiteboard: Claude">
        <div className="modal-head">
          <h3>New: an assistant that knows your courses</h3>
          <div className="spacer" />
          <button ref={setupRef} className="primary" onClick={onSetUp}>Set it up</button>
        </div>

        <div className="modal-body reading">
          <p className="note">
            Whiteboard has an optional Claude tab. It runs on the Claude Code already on
            your computer, so your courses go nowhere new, and it can only read.
          </p>
          <div className="wel-list">
            {THINGS.map(([title, what]) => (
              <div className="wel-item" key={title}>
                <b>{title}</b>
                <p className="note dim">{what}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-foot">
          <span className="note dim">
            Needs Claude Code installed, and the extension updated. Turn it on any time
            in Settings.
          </span>
          <div className="spacer" />
          <button onClick={onClose}>Not now</button>
        </div>
      </div>
    </>
  );
}
