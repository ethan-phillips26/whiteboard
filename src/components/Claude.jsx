import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../api.js";
import * as claude from "../browser/claude.js";
import { dateTime } from "../lib/format.js";
import { DOCX_TYPE, docxBlob, docxName } from "../lib/docx.js";
import DocumentViewer from "./DocumentViewer.jsx";
import Markdown from "./Markdown.jsx";
import Quiz from "./Quiz.jsx";

const useClaude = () => useSyncExternalStore(claude.subscribe, claude.snapshot);

const HOST_ZIP = "whiteboard-claude-host.zip";

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="linkish" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* selectable anyway */ }
    }}>{done ? "Copied" : "Copy"}</button>
  );
}

/** What is wrong with the connection, and the one next step. */
function Setup({ s }) {
  const again = () => claude.connect();
  // Firefox's id is the add-on's own, and a copy with a different one (the local
  // dev copy) is refused by the host's manifest unless it is named here.
  const command = s.extensionId ? `node install.mjs ${s.extensionId}` : "node install.mjs";
  switch (s.status) {
    case "no-extension":
      return (
        <section className="panel">
          <div className="panel-head"><h2>Extension needs updating</h2></div>
          <p className="note">
            The Whiteboard Connector did not answer this feature. If you installed it before
            Claude was added, reload it from your browser's extensions page, then reload this page.
          </p>
          <div className="set-actions"><button onClick={again}>Check again</button></div>
        </section>
      );
    case "no-host":
      return (
        <section className="panel">
          <div className="panel-head"><h2>Connect Claude Code</h2></div>
          <p className="note set-note">
            Whiteboard can use the Claude Code already on this computer. A small helper lets the
            extension start it; it only runs while this tab is open, and Claude can read your
            courses here but cannot change anything.
          </p>
          <ol className="steps">
            <li>Install <a href="https://claude.com/claude-code" target="_blank" rel="noopener noreferrer">Claude Code</a> and
              sign in by running <code>claude</code> once, if you haven't. You'll also need Node.js.</li>
            <li><a href={`./${HOST_ZIP}`} download>Download the helper</a> and unzip it somewhere it can stay.</li>
            <li>In that folder, run: <span className="cmd"><code>{command}</code> <Copy text={command} /></span>
              {!s.extensionId && <span className="note dim"> (add the extension's id from chrome://extensions)</span>}</li>
            <li><button onClick={again}>Check again</button></li>
          </ol>
          {s.detail && !/not found/i.test(s.detail) && <p className="err">{s.detail}</p>}
        </section>
      );
    case "no-claude":
      return (
        <section className="panel">
          <div className="panel-head"><h2>Claude Code not found</h2></div>
          <p className="note">
            The helper is installed, but it could not find <code>claude</code>. Install{" "}
            <a href="https://claude.com/claude-code" target="_blank" rel="noopener noreferrer">Claude Code</a>, sign in
            by running it once, then run <code>node install.mjs</code> in the helper folder again so it
            remembers where it is.
          </p>
          <div className="set-actions"><button onClick={again}>Check again</button></div>
        </section>
      );
    case "connecting":
      return <p className="empty"><span className="spin" /> Connecting to Claude Code…</p>;
    default:
      return null;
  }
}

// Drawn, not typed: the same stroke as the sidebar's icons, so they take the text's
// colour in both themes.
const GLYPHS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cross: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1" fill="currentColor" />,
};
function Glyph({ name, size = 14 }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {GLYPHS[name]}
    </svg>
  );
}

/** What Claude looked up for this answer, as one list rather than a line per call. */
function Steps({ parts }) {
  return (
    <ul className="cl-steps" aria-label="What Claude looked up">
      {parts.map((p) => (
        <li key={p.id} className={p.status}>
          {p.status === "running"
            ? <span className="spin" />
            : <Glyph name={p.status === "failed" ? "cross" : "check"} size={12} />}
          <span>{p.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Artifact({ item, open, onOpen }) {
  const quiz = item.kind === "quiz";
  return (
    <button className={"cl-artifact" + (open ? " on" : "")} onClick={() => onOpen(item.id)}
            aria-current={open ? "true" : undefined}>
      <span className="fileext">{quiz ? "QUIZ" : "DOCX"}</span>
      <span className="cl-artifact-id">
        <b>{item.title}</b>
        <span className="note dim">{quiz ? `Practice quiz · ${item.questions.length} questions` : "Word document"}</span>
      </span>
      <Glyph name="arrow" />
    </button>
  );
}

// What each kind of source is called on its badge. A file is badged by its own extension.
const SOURCE_TAG = { page: "PAGE", assignment: "TASK", announcement: "NEWS", grades: "GRADE", deadlines: "DUE" };
const extOf = (name) => (String(name ?? "").match(/\.([a-z0-9]{1,4})$/i)?.[1] ?? "file").toUpperCase();

/** "p. 3" or "pp. 3–5": the pages Claude read, which is where the file opens. */
const pagesLabel = ([a, b]) => (a === b ? `p. ${a}` : `pp. ${a}–${b}`);

function Source({ src }) {
  const body = (
    <>
      <span className="fileext">{src.kind === "file" ? extOf(src.filename) : SOURCE_TAG[src.kind] ?? "ITEM"}</span>
      <span className="cl-src-title">{src.title}</span>
      {src.pages && <span className="cl-src-pages">{pagesLabel(src.pages)}</span>}
      {src.course && src.kind !== "grades" && <span className="cl-src-course">{src.course}</span>}
    </>
  );
  // A file opens in the reader beside the chat; anything else goes to where it lives.
  if (src.kind === "file") return <button className="cl-src" onClick={() => claude.openSource(src)}>{body}</button>;
  if (src.href?.startsWith("#")) return <a className="cl-src" href={src.href}>{body}</a>;
  if (/^https?:\/\//i.test(src.href ?? "")) {
    return <a className="cl-src" href={src.href} target="_blank" rel="noopener noreferrer">{body}</a>;
  }
  return <span className="cl-src static">{body}</span>;
}

/** What Claude actually read for this answer — recorded as it read, not as it claims. */
function Sources({ sources }) {
  if (!sources?.length) return null;
  return (
    <div className="cl-sources">
      <span className="label">Sources</span>
      <ul>{sources.map((s) => <li key={s.key}><Source src={s} /></li>)}</ul>
    </div>
  );
}

function Message({ m, items, active, onOpen, last, busy }) {
  if (m.role === "user") {
    return <div className="cl-msg user"><p>{m.parts[0].text}</p></div>;
  }
  // Consecutive lookups read as one step list; text and files break it.
  const groups = [];
  for (const p of m.parts) {
    const end = groups[groups.length - 1];
    if (p.type === "tool" && end?.type === "tools") end.parts.push(p);
    else groups.push(p.type === "tool" ? { type: "tools", parts: [p] } : p);
  }
  return (
    <div className="cl-msg assistant">
      {groups.map((g, i) => {
        if (g.type === "text") return <Markdown key={i} text={g.text} />;
        if (g.type === "tools") return <Steps key={i} parts={g.parts} />;
        const item = items.find((x) => x.id === g.itemId);
        return item ? <Artifact key={i} item={item} open={active === item.id} onOpen={onOpen} /> : null;
      })}
      <Sources sources={m.sources} />
      {last && busy && !m.error && (
        <span className="cl-typing" role="status" aria-label="Claude is working"><i /><i /><i /></span>
      )}
      {m.stopped && <p className="cl-stopped note dim">Stopped</p>}
      {m.error && <p className="err">{m.error}</p>}
    </div>
  );
}

function Composer({ busy, ready, onSend, model, effort }) {
  const [text, setText] = useState("");
  const box = useRef(null);
  // Grows with what is typed, up to a few lines, then scrolls inside itself.
  const fit = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    // A scrollbar only once there is more than fits; a one-line field must not show one.
    el.style.overflowY = el.scrollHeight > 168 ? "auto" : "hidden";
  };
  // Sized on arrival too, so it opens at one true line rather than at the browser's default.
  useEffect(fit, []);
  const submit = () => {
    if (!text.trim() || busy || !ready) return;
    onSend(text);
    setText("");
    requestAnimationFrame(fit);
  };
  return (
    <form className="cl-compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="cl-compose-in">
        <div className="cl-field">
          <textarea
            ref={box} rows={1} value={text} aria-label="Message Claude"
            placeholder={ready ? "Ask about your courses…" : "Connecting to Claude…"}
            onChange={(e) => { setText(e.target.value); fit(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              if (e.key === "Escape" && busy) { e.preventDefault(); claude.stop(); }
            }}
          />
          {busy ? (
            <button className="primary cl-send" type="button" aria-label="Stop" title="Stop (Esc)"
                    onClick={claude.stop}>
              <Glyph name="stop" size={16} />
            </button>
          ) : (
            <button className="primary cl-send" type="submit" aria-label="Send"
                    disabled={!text.trim() || !ready}>
              <Glyph name="send" size={16} />
            </button>
          )}
        </div>
        <div className="cl-foot">
          <label className="cl-pick">
            <span>Model</span>
            <select value={model} disabled={busy} onChange={(e) => claude.choose({ model: e.target.value })}>
              {claude.MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="cl-pick">
            <span>Thinking</span>
            <select value={effort} disabled={busy} onChange={(e) => claude.choose({ effort: e.target.value })}>
              {claude.EFFORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <p className="cl-hint note dim">Enter to send · Shift+Enter for a new line</p>
        </div>
      </div>
    </form>
  );
}

// What the empty chat offers: the questions this tab is for, so the first message is a
// click away. The text sent is the sentence, not the title.
const IDEAS = [
  { title: "What is due", hint: "This week's deadlines, and what to start first",
    ask: "What is due this week? Tell me what to start first." },
  { title: "Where I stand", hint: "Grades in every course, and what is left to earn",
    ask: "Where do I stand in each course?" },
  { title: "Practice quiz", hint: "Questions from the latest material in a course",
    ask: "Make me a practice quiz on the most recent material in one of my courses." },
  { title: "Catch up", hint: "A summary of recent announcements",
    ask: "Summarise my recent announcements." },
];

function Welcome({ name, ready, busy, onAsk }) {
  return (
    <div className="cl-welcome">
      <h2 className="cl-hello">What are you working on{name ? `, ${name}` : ""}?</h2>
      <p className="note">
        Ask about deadlines, grades, announcements or course material, or have Claude write a
        study guide or a practice quiz.
      </p>
      <ul className="cl-ideas">
        {IDEAS.map((i) => (
          <li key={i.title}>
            <button disabled={!ready || busy} onClick={() => onAsk(i.ask)}>
              <span className="cl-idea"><b>{i.title}</b><span className="note dim">{i.hint}</span></span>
              <Glyph name="arrow" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chat({ s, name }) {
  const box = useRef(null);
  // Follows the answer as it streams, but only while you are at the bottom: scrolling
  // up to reread something must not be undone by the next word arriving.
  const stick = useRef(true);
  const onScroll = () => {
    const el = box.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [s.messages]);
  const ready = s.status === "ready";
  const send = (text) => { stick.current = true; claude.sendMessage(text); };
  return (
    <section className="panel cl-chat">
      <div className="cl-scroll" ref={box} onScroll={onScroll} aria-live="polite">
        <div className="cl-thread">
          {s.messages.length === 0 ? (
            <Welcome name={name} ready={ready} busy={s.busy} onAsk={send} />
          ) : s.messages.map((m, i) => (
            <Message key={m.id} m={m} items={s.items} active={s.active} onOpen={claude.select}
                     last={i === s.messages.length - 1} busy={s.busy} />
          ))}
        </div>
      </div>
      <Composer busy={s.busy} ready={ready} onSend={send} model={s.model} effort={s.effort} />
    </section>
  );
}

/** The saved chats: open one to carry on, rename it, or delete it. */
function ChatList({ s, onOpened }) {
  const [armed, setArmed] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  if (!s.chats.length) {
    return <p className="empty">Your chats are kept here once you have started one.</p>;
  }
  const finish = (save) => {
    if (save && editing) claude.renameChat(editing, draft);
    setEditing(null);
  };
  return (
    <ul className="cl-lib cl-chats">
      {s.chats.map((c) => (
        <li key={c.id}>
          {editing === c.id ? (
            <input className="cl-rename" value={draft} autoFocus maxLength={80} aria-label="Chat name"
                   onChange={(e) => setDraft(e.target.value)}
                   onFocus={(e) => e.target.select()}
                   onKeyDown={(e) => {
                     if (e.key === "Enter") finish(true);
                     if (e.key === "Escape") finish(false);
                   }}
                   onBlur={() => finish(true)} />
          ) : (
            <button className="cl-lib-open" disabled={s.busy && c.id !== s.chatId}
                    aria-current={c.id === s.chatId ? "true" : undefined}
                    onClick={() => { claude.openChat(c.id); onOpened(); }}>
              <span className="cl-lib-title">{c.title}</span>
              <span className="note dim">
                {[c.id === s.chatId && "Open now", dateTime(new Date(c.updated)),
                  `${Math.ceil(c.messages.length / 2)} ${c.messages.length <= 2 ? "message" : "messages"}`]
                  .filter(Boolean).join(" · ")}
              </span>
            </button>
          )}
          {editing !== c.id && (
            <>
              <button className="linkish"
                      onClick={() => { setDraft(c.title); setEditing(c.id); setArmed(null); }}>Rename</button>
              <button className={armed === c.id ? "danger" : "linkish"}
                      onClick={() => armed === c.id ? (claude.deleteChat(c.id), setArmed(null)) : setArmed(c.id)}
                      onBlur={() => setArmed(null)}>
                {armed === c.id ? "Delete?" : "Delete"}
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function Library({ s, courses }) {
  const [armed, setArmed] = useState(null);
  const label = (id) => courses.find((c) => c.course_id === id)?.label;
  if (!s.items.length) {
    return <p className="empty">Documents and quizzes Claude makes for you are kept here.</p>;
  }
  return (
    <ul className="cl-lib">
      {s.items.map((i) => {
        const last = i.attempts?.[0];
        return (
          <li key={i.id}>
            <button className="cl-lib-open" onClick={() => claude.select(i.id)}>
              <span className="label">{i.kind === "quiz" ? `Quiz · ${i.questions.length} questions` : "Word document"}</span>
              <span className="cl-lib-title">{i.title}</span>
              <span className="note dim">
                {[label(i.course_id), dateTime(new Date(i.created)), last && `last ${Math.round(last.earned * 10) / 10}/${last.total}`]
                  .filter(Boolean).join(" · ")}
              </span>
            </button>
            <button className={armed === i.id ? "danger" : "linkish"}
                    onClick={() => armed === i.id ? (claude.removeItem(i.id), setArmed(null)) : setArmed(i.id)}
                    onBlur={() => setArmed(null)}>
              {armed === i.id ? "Delete?" : "Delete"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A document, as a Word file opened in the same reader the course files use, set
 * beside the chat rather than over it. */
function DocStage({ item, onClose, actions }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let url = null;
    let live = true;
    setFile(null);
    setError(null);
    docxBlob(item.title, item.markdown).then((blob) => {
      url = URL.createObjectURL(blob);
      if (live) setFile({ filename: docxName(item.title), url, view: url, type: DOCX_TYPE, bytes: blob.size });
    }).catch((e) => live && setError(e.message));
    return () => {
      live = false;
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }, [item.id, item.title, item.markdown]);

  if (file) return <DocumentViewer inline file={file} onClose={onClose} actions={actions} />;
  return (
    <section className="panel cl-stage">
      <div className="panel-head"><h2>Document</h2><div className="spacer" />{actions}<button onClick={onClose}>Close</button></div>
      {error ? <p className="err">{error}</p> : <p className="empty"><span className="spin" /> Preparing the document…</p>}
    </section>
  );
}

/** A file a source points at, fetched the way the course materials fetch one and
 * read in the same viewer, beside the chat. */
function SourceReader({ source, onClose }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setFile(null);
    setError(null);
    api.fetchFiles(source.courseId, source.contentId).then((r) => {
      const got = (r.downloaded ?? []).find((d) => d.original === source.filename || d.filename === source.filename);
      if (!live) return;
      if (got) setFile({ ...got, page: source.pages?.[0], origin: { courseId: source.courseId, contentId: source.contentId } });
      else setError(`${source.filename} could not be fetched from Blackboard.`);
    }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [source.key, source.courseId, source.contentId, source.filename, source.pages]);

  if (file) return <DocumentViewer inline file={file} onClose={onClose} />;
  return (
    <section className="panel cl-stage">
      <div className="panel-head"><h2>{source.filename}</h2><div className="spacer" /><button onClick={onClose}>Close</button></div>
      {error ? <p className="err">{error}</p> : <p className="empty"><span className="spin" /> Fetching the file…</p>}
    </section>
  );
}

function Stage({ s, courses, mode, onClose, onLibrary, onOpened }) {
  if (s.reading) return <SourceReader source={s.reading} onClose={onClose} />;
  const item = s.items.find((i) => i.id === s.active);
  const toLibrary = <button onClick={onLibrary}>Library</button>;
  if (item?.kind === "document") {
    return <DocStage item={item} onClose={onClose} actions={toLibrary} />;
  }
  return (
    <section className="panel cl-stage">
      <div className="panel-head">
        <h2>{item ? "Practice quiz" : mode === "chats" ? "Chats" : "Library"}</h2>
        <div className="spacer" />
        {item && toLibrary}
        <button onClick={onClose}>Close</button>
      </div>
      {/* Scrolls by itself: the page and the chat stay where they are. */}
      <div className="cl-stage-body">
        {item ? (
          <>
            <h3 className="cl-title">{item.title}</h3>
            <Quiz key={item.id} item={item} />
          </>
        ) : mode === "chats" ? <ChatList s={s} onOpened={onOpened} /> : <Library s={s} courses={courses} />}
      </div>
    </section>
  );
}

export default function Claude({ courses, name = "" }) {
  const s = useClaude();
  // What the right-hand half is showing when no document or quiz is open.
  const [panel, setPanel] = useState(null);
  useEffect(() => {
    claude.connect();
    claude.loadSaved();
  }, []);
  const failed = ["no-extension", "no-host", "no-claude", "connecting"].includes(s.status);
  const staged = !!s.active || !!panel || !!s.reading;
  const closeStage = () => { claude.select(null); setPanel(null); };
  const show = (which) => { claude.select(null); setPanel(panel === which && !s.active && !s.reading ? null : which); };
  const current = s.chats.find((c) => c.id === s.chatId);

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Claude</h1>
          {current && <p className="note dim cl-current" title={current.title}>{current.title}</p>}
        </div>
        <div className="spacer" />
        <div className="row actions">
          {s.chats.length > 0 && <button onClick={() => show("chats")}>Chats ({s.chats.length})</button>}
          {s.items.length > 0 && <button onClick={() => show("library")}>Library ({s.items.length})</button>}
          {s.messages.length > 0 && <button onClick={claude.newChat} disabled={s.busy}>New chat</button>}
        </div>
      </header>

      {failed && <Setup s={s} />}

      {!failed && (
        <div className={"cl" + (staged ? " has-stage" : "")}>
          <Chat s={s} name={name} />
          {staged && (
            <Stage s={s} courses={courses} mode={panel} onClose={closeStage}
                   onLibrary={() => show("library")} onOpened={closeStage} />
          )}
        </div>
      )}
    </>
  );
}
