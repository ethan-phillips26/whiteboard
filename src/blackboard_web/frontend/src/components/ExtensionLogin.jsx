import { useEffect, useState } from "react";
import { api } from "../api.js";

const SOURCE = "https://github.com/ethan-phillips26/blackboard-dashboard/tree/main/extension";
const REMEMBERED = "whiteboard-host";

const bare = (origin) => (origin ?? "").replace(/^https?:\/\//, "");

function remembered() {
  try { return localStorage.getItem(REMEMBERED) ?? ""; } catch { return ""; }
}

/**
 * Signing in when this page is all there is.
 *
 * A web page cannot read another site's data, so the Whiteboard Connector
 * extension does the reading, with the Blackboard session already in this
 * browser, and hands the results to the page. Getting there takes three steps,
 * and each happens somewhere this page cannot see into — the install, the
 * extension's permission prompt, and the university's own sign-in in a tab of
 * its own — so each ends with the page asking the extension how things stand
 * until the answer changes.
 */
export default function ExtensionLogin({ auth, onSignedIn }) {
  const [status, setStatus] = useState(auth);
  const [host, setHost] = useState(() => bare(auth?.host) || remembered());
  const [waiting, setWaiting] = useState(null); // "permission" | "signin" | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!waiting) return undefined;
    const started = Date.now();
    const id = setInterval(async () => {
      const s = await api.authStatus().catch(() => null);
      if (!s) return;
      if (s.logged_in) {
        clearInterval(id);
        onSignedIn(s);
      } else if ((waiting === "permission" && s.state !== "needs-permission") ||
                 Date.now() - started > 10 * 60e3) {
        setWaiting(null);
        setStatus(s);
      }
    }, 1500);
    return () => clearInterval(id);
  }, [waiting, onSignedIn]);

  async function connect(event) {
    event.preventDefault();
    const value = host.trim();
    if (!value) return;
    try { localStorage.setItem(REMEMBERED, value); } catch { /* a convenience only */ }
    setBusy(true);
    setError(null);
    try {
      const s = await api.connect(value);
      if (s.state === "signed-in") onSignedIn(await api.authStatus());
      else if (s.state === "needs-permission") setWaiting("permission");
      else setStatus({ ...s, logged_in: false });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await api.signIn();
      setWaiting("signin");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const where = bare(status?.host);
  let title;
  let body;

  if (status?.state === "no-extension") {
    title = "Install the Whiteboard Connector";
    body = (
      <>
        <p className="note">
          This page can't read Blackboard by itself — browsers don't let one site
          read another's data. The Whiteboard Connector extension does the
          reading, using the Blackboard session already in this browser, and only
          ever reads.
        </p>
        <p className="note dim">
          Get the extension from <a className="link" href={SOURCE} target="_blank"
          rel="noreferrer">its folder on GitHub</a>. In Chrome or Edge, open the
          extensions page, turn on developer mode and load that folder unpacked. In
          Firefox, open about:debugging and load its manifest.json as a temporary
          add-on.
        </p>
        <button className="primary login-submit" onClick={() => window.location.reload()}>
          I've installed it — reload
        </button>
      </>
    );
  } else if (waiting === "permission") {
    title = "Allow access";
    body = (
      <p className="note dim">
        <span className="spin" /> The extension opened a tab asking to read{" "}
        <b>{bare(host) || where}</b>. Allow it there, and this page carries on by
        itself.
      </p>
    );
  } else if (waiting === "signin") {
    title = "Waiting for your sign-in";
    body = (
      <>
        <p className="note dim">
          <span className="spin" /> Blackboard is open in a new tab. Sign in there —
          including anything on your phone — and this page picks up as soon as
          you're in.
        </p>
        <p className="note dim">That tab closes itself when you're done.</p>
      </>
    );
  } else if (status?.state === "signed-out") {
    title = "Sign in to Blackboard";
    body = (
      <>
        <p className="note">You're not signed in to <b>{where}</b> in this browser.</p>
        <button className="primary login-submit" onClick={signIn} disabled={busy}>
          {busy ? <span className="spin" /> : "Open Blackboard's sign-in"}
        </button>
        <p className="note dim">
          <button className="linkish" onClick={() => setStatus({ state: "not-connected",
                                                                  host: status.host })}>
            Use a different Blackboard
          </button>
        </p>
      </>
    );
  } else {
    title = "Connect to Blackboard";
    body = (
      <form className="login-form" onSubmit={connect}>
        {status?.state === "error" && (
          <p className="note error">
            Blackboard answered, but not the way a signed-in session does. Check
            the address.
          </p>
        )}
        <label className="field">
          <span>Blackboard address</span>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="blackboard.university.edu"
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <button type="submit" className="primary login-submit" disabled={busy || !host.trim()}>
          {busy ? <span className="spin" /> : "Connect"}
        </button>
      </form>
    );
  }

  return (
    <div className="boot">
      <div className="panel login-panel">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true" />
          <h2>{title}</h2>
        </div>
        {body}
        {error && <p className="note error">{error}</p>}
      </div>
    </div>
  );
}
