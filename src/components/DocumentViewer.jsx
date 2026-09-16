import { useCallback, useEffect, useRef, useState } from "react";
import { extension } from "../lib/download.js";
import { filesize } from "../lib/format.js";
import { READER, useTitle } from "../lib/title.js";
import { kindOf, readDeck, whyNot } from "../lib/viewer.js";
import { canStream, holdStream, releaseStream, streamUrl, whyNoStream } from "../browser/stream.js";
import GoogleButton from "./GoogleButton.jsx";

/**
 * A handout, read in the page.
 *
 * The browser already draws a PDF, a picture, a video and a text file, so those
 * are pointed straight at the file. Word and PowerPoint it cannot, so they are
 * read here rather than converted on the server: the machine serving this app is
 * not necessarily the machine you are reading on, and nothing about the feature
 * should depend on an office suite being installed on either of them.
 *
 * Anything else says what it is and offers the download, which is the honest
 * answer and better than an empty frame.
 */
// A lecture is watched at the speed you watch lectures at, so the choice is
// remembered the way the theme is rather than asked again for every file.
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SPEED_KEY = "speed";

function storedSpeed() {
  try {
    const rate = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.includes(rate) ? rate : 1;
  } catch {
    // A private window can refuse storage outright; 1× is the honest default.
    return 1;
  }
}

export default function DocumentViewer({ file, onClose }) {
  const kind = kindOf(file.filename);
  const [status, setStatus] = useState(kind === "docx" || kind === "pptx" ? "loading" : "ready");
  const [error, setError] = useState(null);
  // Kept apart from `error`: that one replaces the document with a fallback, and
  // a failed upload is no reason to stop showing what is being read.
  const [sendError, setSendError] = useState(null);
  const [text, setText] = useState(null);
  const [deck, setDeck] = useState(null);
  const docxRef = useRef(null);
  const closeRef = useRef(null);
  const mediaRef = useRef(null);
  const [speed, setSpeed] = useState(storedSpeed);
  const playable = kind === "video" || kind === "audio";

  // Whatever opened this reader — a deadline's handout or a file in the course
  // materials — the document on screen is now the thing being read, so it takes
  // the tab and gives it back on close.
  useTitle([file.filename], READER);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A streamed file has no bytes in the page at all. Its URL is one this app
  // serves and the service worker answers, so it is minted once and given back
  // when the reader closes — the map behind it is what keeps a Blackboard path
  // out of the markup.
  const [streamSrc] = useState(() =>
    file.streamable && file.source && canStream()
      ? streamUrl(file.source, { type: file.type, filename: file.filename })
      : null);

  // Claimed on the way in as well as released on the way out: StrictMode runs
  // this pair twice in development, and a release that could not be undone left
  // the URL pointing at nothing.
  useEffect(() => {
    if (!streamSrc) return undefined;
    holdStream(streamSrc, file.source, { type: file.type, filename: file.filename });
    return () => releaseStream(streamSrc);
  }, [streamSrc, file.source, file.type, file.filename]);

  const source = streamSrc ?? file.view ?? file.url;

  // Word and PowerPoint are read here; everything else is pointed at the file.
  useEffect(() => {
    if (kind !== "docx" && kind !== "pptx" && kind !== "text") return;
    let live = true;
    let urls = [];
    setStatus("loading");
    setError(null);

    (async () => {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`The file could not be read (${res.status}).`);
      if (kind === "text") {
        const body = await res.text();
        if (live) setText(body);
        return;
      }
      const buffer = await res.arrayBuffer();
      if (!live) return;
      if (kind === "pptx") {
        const read = await readDeck(buffer);
        urls = read.urls;
        if (live) setDeck(read.slides);
        return;
      }
      // docx-preview writes the document's own styles into the container, so it
      // is loaded only for the documents that need it.
      const { renderAsync } = await import("docx-preview");
      if (!live || !docxRef.current) return;
      await renderAsync(buffer, docxRef.current, null, {
        className: "docx", inWrapper: true, breakPages: true,
        ignoreLastRenderedPageBreak: true, useBase64URL: true,
      });
    })()
      .catch((e) => live && setError(e.message))
      .finally(() => live && setStatus("ready"));

    return () => {
      live = false;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [kind, source]);

  const size = filesize(file.bytes);
  const busy = status === "loading";

  // playbackRate is a property, not an attribute, so React will not write it
  // from JSX — and the element resets it to 1 each time it loads a source, which
  // is why it is set again on loadedmetadata rather than only here.
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = speed;
  }, [speed, kind, source]);

  function chooseSpeed(rate) {
    setSpeed(rate);
    try {
      localStorage.setItem(SPEED_KEY, String(rate));
    } catch {
      // It still applies to what is playing; it just will not be remembered.
    }
  }

  const body = useCallback(() => {
    // Streaming is the only way this file could play, and this browser has no
    // worker to do it with. Saying so beats an element that silently shows black.
    if (file.streamable && !streamSrc) {
      return (
        <div className="viewer-fallback">
          <p className="note">
            {whyNoStream() === "demo"
              ? "The demo's lectures are made up, so there is no video behind this one."
              : "This video is too large to fetch, and streaming it needs a service " +
                "worker, which this browser doesn't have here. Open it in Blackboard " +
                "instead."}
          </p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="viewer-fallback">
          <p className="err">{error}</p>
          <a className="btn primary" href={file.url} download={file.filename}>
            Download it instead
          </a>
        </div>
      );
    }
    switch (kind) {
      case "pdf":
        return <iframe className="viewer-frame" src={source} title={file.filename} />;
      case "image":
        return <img className="viewer-image" src={source} alt={file.filename} />;
      case "video":
        return (
          <video ref={mediaRef} className="viewer-media" src={source} controls
                 autoPlay={false}
                 onLoadedMetadata={(e) => { e.currentTarget.playbackRate = speed; }} />
        );
      case "audio":
        return (
          <audio ref={mediaRef} className="viewer-media" src={source} controls
                 onLoadedMetadata={(e) => { e.currentTarget.playbackRate = speed; }} />
        );
      case "text":
        return text == null ? null : <pre className="viewer-text">{text}</pre>;
      case "docx":
        return <div className="viewer-docx" ref={docxRef} />;
      case "pptx":
        return deck ? <Deck slides={deck} /> : null;
      default:
        return (
          <div className="viewer-fallback">
            <p className="note">{whyNot(file.filename)}</p>
            <div className="row">
              <a className="btn primary" href={file.url} download={file.filename}>
                Download
              </a>
            </div>
          </div>
        );
    }
  }, [kind, error, source, text, deck, file, speed, streamSrc]);

  return (
    <>
      <div className="scrim over" onClick={onClose} />
      <div className="viewer" role="dialog" aria-modal="true" aria-label={file.filename}>
        <div className="viewer-head">
          <span className="fileext" aria-hidden="true">{extension(file.filename)}</span>
          <div className="viewer-id">
            <b title={file.filename}>{file.filename}</b>
            <span className="note dim">
              {size}
              {kind === "docx" || kind === "pptx" ? " · read in the browser" : ""}
            </span>
          </div>
          <div className="spacer" />
          {playable && (
            <div className="seg speed" role="group" aria-label="Playback speed">
              {SPEEDS.map((rate) => (
                <button key={rate} className={speed === rate ? "on" : ""}
                        aria-pressed={speed === rate}
                        onClick={() => chooseSpeed(rate)}>
                  {rate}×
                </button>
              ))}
            </div>
          )}
          <GoogleButton filename={file.filename} getFile={() => file}
                        onError={setSendError} />
          {/* Nothing is held for a streamed file, so there is nothing to save. */}
          {file.url && (
            <a className="btn" href={file.url} download={file.filename}>Download</a>
          )}
          <button ref={closeRef} onClick={onClose}>Close</button>
          {sendError && <p className="err">{sendError}</p>}
        </div>

        <div className={`viewer-body kind-${error ? "none" : kind}`}>
          {body()}
          {busy && (
            <p className="viewer-busy">
              <span className="spin" /> Reading {extension(file.filename)}…
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/** A deck as something you can read:each slide's heading, its text, its pictures. */
function Deck({ slides }) {
  if (!slides?.length) {
    return <p className="empty viewer-busy">This deck has no slides in it.</p>;
  }
  return (
    <div className="deck">
      {slides.map((slide) => (
        <section className="slide" key={slide.number}>
          <div className="slide-no">Slide {slide.number}</div>
          {slide.title && <h3>{slide.title}</h3>}
          {slide.images.length > 0 && (
            <div className="slide-images">
              {slide.images.map((src) => (
                <img key={src} src={src} alt="" loading="lazy" />
              ))}
            </div>
          )}
          {slide.lines.length > 0 && (
            <ul className="slide-lines">
              {slide.lines.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
          {slide.notes.length > 0 && (
            <details className="slide-notes">
              <summary>Speaker notes</summary>
              {slide.notes.map((line, i) => <p key={i}>{line}</p>)}
            </details>
          )}
          {!slide.title && !slide.lines.length && !slide.images.length && (
            <p className="empty">Nothing on this slide but its layout.</p>
          )}
        </section>
      ))}
    </div>
  );
}
