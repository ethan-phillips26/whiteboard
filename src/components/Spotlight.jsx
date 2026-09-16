import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { courseSlot, relative } from "../lib/format.js";
import { LAYER, useTopmost } from "../lib/overlay.js";
import { rank } from "../lib/rank.js";
import { go, href } from "../lib/route.js";
import { Sep } from "./Sep.jsx";

/**
 * One field over everything.
 *
 * Blackboard makes you remember which course a thing was in before you can go
 * and look for it, which is exactly backwards: you remember the handout, not the
 * folder it was filed in. This searches the whole term at once — the work, the
 * posts, every document and every file name, and the text of anything that has
 * been read in the page — and opens what you pick.
 *
 * It opens instantly over what has already been read and fills in behind itself.
 * A course's material is only fetched when its Materials tab is opened, so the
 * first search of a term has courses it has never seen; those are walked in the
 * background, one at a time, and the count of what is left is on screen while it
 * happens. Waiting for all of them before showing the first row would make this
 * a thing nobody used.
 */

const KIND = {
  command: "Action",
  course: "Course",
  assignment: "Assignment",
  announcement: "Announcement",
  material: "Material",
  file: "File",
};

// What an empty field offers: the actions, then what is actually due. Enough to
// be worth opening with nothing typed, short enough to read at a glance.
const SUGGESTED = 6;

export default function Spotlight({ data, order, commands, onOpenAssignment,
                                    onClose }) {
  const [query, setQuery] = useState("");
  const [corpus, setCorpus] = useState(null);
  const [reading, setReading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // The palette is summoned from anywhere and is always frontmost, so it owns
  // Escape while it is up and the drawer or reader underneath stands down.
  const isTop = useTopmost(LAYER.top);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Assembled once from what the page holds and what has been read of each
  // course, then again after each further course arrives.
  useEffect(() => {
    let live = true;
    (async () => {
      const built = await api.searchCorpus(data);
      if (!live) return;
      setCorpus(built);
      if (!built.unread.length) return;
      setReading(true);
      await api.warmSearch(built.unread, async () => {
        const next = await api.searchCorpus(data);
        if (live) setCorpus(next);
      });
      if (live) setReading(false);
    })().catch(() => {
      // A corpus that cannot be built is an empty one: the field still works on
      // the courses and deadlines already in hand.
      if (live) setReading(false);
    });
    return () => { live = false; };
  }, [data]);

  const records = useMemo(() => [
    ...commands.map((c) => ({
      kind: "command", id: `command:${c.id}`, title: c.title,
      subtitle: c.subtitle ?? "", run: c.run,
    })),
    ...(corpus?.records ?? []),
  ], [commands, corpus]);

  const results = useMemo(() => {
    if (query.trim()) return rank(records, query, { limit: 30 });
    const upcoming = records
      .filter((r) => r.kind === "assignment")
      .slice(0, SUGGESTED);
    return [...records.filter((r) => r.kind === "command"), ...upcoming]
      .map((record, index) => ({ record, index, snippet: "" }));
  }, [records, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // The selected row has to stay on screen while the arrows walk past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  const open = useCallback((record) => {
    if (!record) return;
    onClose();
    switch (record.kind) {
      case "command":
        record.run();
        break;
      case "course":
        go(href.course(record.courseId));
        break;
      case "announcement":
        go(href.announcements);
        break;
      case "assignment":
        onOpenAssignment({
          courseId: record.courseId, contentId: record.contentId,
          columnId: record.columnId, title: record.title, course: record.course,
          points: record.points,
          due: record.due ? new Date(record.due) : null,
        });
        break;
      case "material":
        // A link is a place to go; anything with instructions or handouts behind
        // it opens where those are read; the rest is only findable in place.
        if (record.url) window.open(record.url, "_blank", "noopener,noreferrer");
        else if (record.openable) {
          onOpenAssignment({
            courseId: record.courseId, contentId: record.contentId,
            columnId: record.columnId, title: record.title, course: record.course,
          });
        } else go(href.course(record.courseId, "materials"));
        break;
      case "file":
        // The file lives on its item, and the drawer is what fetches it.
        onOpenAssignment({
          courseId: record.courseId, contentId: record.contentId,
          title: record.subtitle || record.title, course: record.course,
        });
        break;
      default:
        break;
    }
  }, [onClose, onOpenAssignment]);

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(results[active]?.record);
    } else if (e.key === "Escape" && isTop) {
      e.preventDefault();
      onClose();
    }
  }

  const unread = corpus?.unread?.length ?? 0;

  return (
    <>
      <div className="scrim top" onClick={onClose} />
      <div className="spot" role="dialog" aria-modal="true" aria-label="Search">
        <div className="spot-field">
          <span className="spot-mark" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="spot-results"
            aria-autocomplete="list"
            value={query}
            placeholder="Search assignments, documents, slides, posts…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {reading && (
            <span className="note dim spot-reading">
              <span className="spin" /> reading {unread}
            </span>
          )}
        </div>

        <div className="spot-body" ref={listRef}>
          {!query.trim() && (
            <div className="label spot-group">Jump to</div>
          )}
          {results.length === 0 ? (
            <p className="empty">
              {corpus
                ? "Nothing in your courses matches that."
                : <><span className="spin" /> Gathering your courses…</>}
            </p>
          ) : (
            <div id="spot-results" role="listbox" aria-label="Results">
              {results.map(({ record, snippet }, i) => (
                <button
                  className="detail spot-row"
                  key={record.id}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => open(record)}
                >
                  <div className="detail-head">
                    {record.courseId && order && (
                      <i className={"dot s" + courseSlot(record.course, order)} />
                    )}
                    <b>{record.title}</b>
                    <span className="spot-kind">{KIND[record.kind]}</span>
                  </div>
                  <div className="note dim spot-meta">
                    {[
                      record.course && record.kind !== "course" &&
                        <span key="course">{record.course}</span>,
                      record.subtitle && <span key="sub">{record.subtitle}</span>,
                      record.due &&
                        <span key="due">due {relative(new Date(record.due))}</span>,
                    ].filter(Boolean).map((part, n) => (
                      <span key={part.key}>{n > 0 && <Sep />}{part}</span>
                    ))}
                  </div>
                  {snippet && <div className="note dim spot-snip">{snippet}</div>}
                </button>
              ))}
            </div>
          )}
          {unread > 0 && !reading && (
            <p className="note dim spot-foot-note">
              {unread} {unread === 1 ? "course has" : "courses have"} not been read
              yet, so their material is not in these results.
            </p>
          )}
        </div>

        <div className="spot-foot note dim">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <Sep /><span><kbd>↵</kbd> open</span>
          <Sep /><span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </>
  );
}
