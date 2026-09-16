import { useCallback, useEffect, useRef, useState } from "react";
import { extension } from "../lib/download.js";
import { filesize } from "../lib/format.js";
import { LAYER, useTopmost } from "../lib/overlay.js";
import { READER, useTitle } from "../lib/title.js";
import { kindOf, whyNot } from "../lib/viewer.js";
import { previewNatively, previewsNatively } from "../browser/quicklook.js";
import { rememberFileText } from "../browser/search.js";
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
  // In the iPhone app these are shown by iOS, over this reader, which closes with it.
  const native = previewsNatively(kind);
  const [status, setStatus] = useState(
    native || kind === "docx" || kind === "pptx" ? "loading" : "ready");
  const [error, setError] = useState(null);
  // Kept apart from `error`: that one replaces the document with a fallback, and
  // a failed upload is no reason to stop showing what is being read.
  const [sendError, setSendError] = useState(null);
  const [text, setText] = useState(null);
  const docxRef = useRef(null);
  const pptxRef = useRef(null);
  // The live previewer, kept so the arrow keys can drive the deck it drew.
  const deckRef = useRef(null);
  const closeRef = useRef(null);
  const mediaRef = useRef(null);
  const [speed, setSpeed] = useState(storedSpeed);
  const playable = kind === "video" || kind === "audio";

  // Whatever opened this reader — a deadline's handout or a file in the course
  // materials — the document on screen is now the thing being read, so it takes
  // the tab and gives it back on close.
  useTitle([file.filename], READER);

  // Escape belongs to whatever is on top, which is not necessarily this: the
  // search palette opens over the document being read.
  const isTop = useTopmost(LAYER.reader);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && isTop && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isTop]);

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

  // Read through a ref: callers pass a fresh arrow each render, and an effect that
  // depended on it would open the document again every time the parent redrew.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!native) return undefined;
    let live = true;
    previewNatively(source, file.filename, {
      onText: (words) => rememberFileText(file.origin, file.filename, words),
    })
      .then(() => live && onCloseRef.current())
      .catch((e) => {
        if (!live) return;
        setError(e.message);
        setStatus("ready");
      });
    return () => { live = false; };
  }, [native, source, file.origin, file.filename]);

  // Word is read here; everything else is pointed at the file.
  useEffect(() => {
    if (native || (kind !== "docx" && kind !== "text")) return undefined;
    let live = true;
    setStatus("loading");
    setError(null);

    (async () => {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`The file could not be read (${res.status}).`);
      if (kind === "text") {
        const body = await res.text();
        if (live) setText(body);
        // Drawn once, searchable from then on. This is the only moment the
        // text exists in the page without anything extra being fetched.
        rememberFileText(file.origin, file.filename, body);
        return;
      }
      const buffer = await res.arrayBuffer();
      if (!live) return;
      // docx-preview writes the document's own styles into the container, so it
      // is loaded only for the documents that need it.
      const { renderAsync } = await import("docx-preview");
      if (!live || !docxRef.current) return;
      await renderAsync(buffer, docxRef.current, null, {
        className: "docx", inWrapper: true, breakPages: true,
        ignoreLastRenderedPageBreak: true, useBase64URL: true,
      });
      rememberFileText(file.origin, file.filename, docxRef.current?.innerText);
    })()
      .catch((e) => live && setError(e.message))
      .finally(() => live && setStatus("ready"));

    return () => { live = false; };
  }, [native, kind, source, file.origin, file.filename]);

  /**
   * A deck, drawn as it was designed.
   *
   * This used to read the deck's *content* — headings, bullets, pictures — which
   * is a different document from the one the lecturer made. pptx-preview places
   * the shapes where the file says they go instead, so what is on screen is the
   * slide. It is loaded only for the files that need it, like the Word renderer.
   *
   * It wants a stage in fixed pixels, so the largest 16:9 box the body can hold
   * is measured once and handed over. It is not re-measured: resizing the window
   * mid-deck keeps the size it opened at.
   */
  useEffect(() => {
    if (native || kind !== "pptx") return undefined;
    let live = true;
    let shown = null;
    setStatus("loading");
    setError(null);

    (async () => {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`The file could not be read (${res.status}).`);
      const buffer = await res.arrayBuffer();
      const { init } = await import("pptx-preview");
      if (!live || !pptxRef.current) return;
      const box = pptxRef.current.getBoundingClientRect();
      const width = Math.max(320, Math.floor(Math.min(box.width, (box.height * 16) / 9)));
      shown = init(pptxRef.current, {
        width, height: Math.round((width * 9) / 16), mode: "slide",
      });
      deckRef.current = shown;
      await shown.preview(buffer);
      // Only the slide on screen is drawn, so this is what the deck says rather
      // than all of it — enough to find the lecture again, which is the point.
      rememberFileText(file.origin, file.filename, pptxRef.current?.innerText);
    })()
      .catch((e) => live && setError(e.message))
      .finally(() => live && setStatus("ready"));

    return () => {
      live = false;
      deckRef.current = null;
      shown?.destroy?.();
    };
  }, [native, kind, source, file.origin, file.filename]);

  // A slideshow is driven with the arrow keys, not only the buttons it draws.
  // Escape still belongs to whatever is on top, which is handled above.
  useEffect(() => {
    if (kind !== "pptx") return undefined;
    const onKey = (e) => {
      if (!deckRef.current) return;
      if (e.key === "ArrowRight") deckRef.current.renderNextSlide();
      else if (e.key === "ArrowLeft") deckRef.current.renderPreSlide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind]);

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
    // iOS is drawing it; the busy note underneath is all this reader shows.
    if (native) return null;
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
        return <div className="viewer-pptx" ref={pptxRef} />;
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
  }, [native, kind, error, source, text, file, speed, streamSrc]);

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

