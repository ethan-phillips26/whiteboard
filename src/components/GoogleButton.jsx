import { useState } from "react";
import { api } from "../api.js";
import { appFor, available } from "../browser/google.js";

/**
 * Send one handout to Google Docs, Slides or Sheets.
 *
 * It sits beside "View" rather than replacing it: reading a file in the page and
 * opening it in Google are two different things to want, and which one you want
 * changes file by file, so both are always offered and neither is a setting.
 *
 * It draws nothing at all for a file Google has no use for, or in a build with
 * no client id configured.
 */
export default function GoogleButton({ filename, getFile, onError, className = "" }) {
  const [busy, setBusy] = useState(false);
  const app = appFor(filename);

  if (!available() || !app) return null;

  async function open() {
    setBusy(true);
    onError?.(null);
    try {
      // The tab is opened inside this call, while the click still counts.
      await api.openInGoogle(filename, getFile);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={`hold ${className}`.trim()}
      onClick={open}
      disabled={busy}
      title={`Open ${filename} in Google ${app}`}
    >
      <span aria-hidden={busy}>Google {app}</span>
      <span aria-hidden={!busy}><span className="spin" /> Sending</span>
    </button>
  );
}
