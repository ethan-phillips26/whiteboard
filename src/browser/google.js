/**
 * Opening a handout in Google Docs, Slides or Sheets.
 *
 * Blackboard serves a file only to the session that asked for it, so Google
 * cannot fetch one itself — no URL we could hand it would work. The bytes are
 * already here, though, so the page uploads them to the student's own Drive and
 * asks Drive to convert on the way in. Nothing about a course is sent anywhere
 * else, and nothing here touches Blackboard: this writes to one Drive, the
 * student's, and only the file they pressed.
 *
 * The whole exchange is one browser tab, because a click only buys one popup.
 * That tab is opened first, shows that something is happening, carries the
 * consent redirect if a token is needed, and ends up as the document itself
 * (google/index.html relays over a BroadcastChannel, since the trip through
 * accounts.google.com can sever the opener handle).
 *
 * Nothing at module scope may touch `window`: the components that import this
 * are bundled and rendered in node by tests/test_course_page.mjs.
 */

import { DEMO, NATIVE } from "./mode.js";

// Paste the OAuth client id from the Google Cloud project here. Until it is set
// the feature hides itself, so a build without one is simply a build without
// Google in it. The id is public by design — it is in every request the browser
// makes — and the only thing it authorises is the consent screen.
export const CLIENT_ID = "3317979844-p8u92rr4ph2tl27n2obrah5hutnu0dno.apps.googleusercontent.com";

// Only files the app itself created. It is Google's non-sensitive tier, so the
// consent screen carries no "unverified app" warning, and nothing else in the
// student's Drive is ever legible to this page.
const SCOPE = "https://www.googleapis.com/auth/drive.file";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FILES = "https://www.googleapis.com/drive/v3/files";
const REVOKE = "https://oauth2.googleapis.com/revoke";

const CHANNEL = "whiteboard-google";

// Drive takes a small file in one request; above this it wants a session, and
// the session URI comes back in a header the docs do not promise a browser can
// read. Below the line is the path that is known to work.
const MULTIPART_MAX = 5 * 1024 * 1024;

// Consent, then an upload of unknown size, then the document opening. Long
// enough for a slow file on a bad connection, short enough that a tab closed
// mid-consent does not leave a button spinning for the afternoon.
const PATIENCE_MS = 3 * 60 * 1000;

/* ------------------------------------------------------------------ formats */

// What Google converts, and what it becomes. PDFs and images are deliberately
// absent: Drive runs OCR on those, which produces a document that looks like
// the handout and is not it. They read properly in the page's own viewer.
const DOCUMENT = "application/vnd.google-apps.document";
const PRESENTATION = "application/vnd.google-apps.presentation";
const SPREADSHEET = "application/vnd.google-apps.spreadsheet";

const FORMATS = {
  docx: [DOCUMENT, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  doc: [DOCUMENT, "application/msword"],
  odt: [DOCUMENT, "application/vnd.oasis.opendocument.text"],
  rtf: [DOCUMENT, "application/rtf"],
  pptx: [PRESENTATION, "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ppt: [PRESENTATION, "application/vnd.ms-powerpoint"],
  odp: [PRESENTATION, "application/vnd.oasis.opendocument.presentation"],
  xlsx: [SPREADSHEET, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  xls: [SPREADSHEET, "application/vnd.ms-excel"],
  ods: [SPREADSHEET, "application/vnd.oasis.opendocument.spreadsheet"],
  csv: [SPREADSHEET, "text/csv"],
  tsv: [SPREADSHEET, "text/tab-separated-values"],
};

// What the button calls the place it is sending you. Google's own product
// names, because that is what the tab that opens will say.
const APPS = {
  [DOCUMENT]: "Docs",
  [PRESENTATION]: "Slides",
  [SPREADSHEET]: "Sheets",
};

const suffix = (filename) => {
  const dot = (filename ?? "").lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
};

/** The Google type this file converts to, or null for one that does not. */
export function targetType(filename) {
  return FORMATS[suffix(filename)]?.[0] ?? null;
}

/** What to send as the file's own type. Blackboard often says only "bytes",
 * and Drive converts by what it is told, so the extension decides. */
export function sourceType(filename) {
  return FORMATS[suffix(filename)]?.[1] ?? "application/octet-stream";
}

/** "Docs", "Slides", "Sheets" — or null if Google has nothing to open it in. */
export function appFor(filename) {
  const target = targetType(filename);
  return target ? APPS[target] : null;
}

/** The document's name in Drive: the handout without its extension, since the
 * format it used to be in is not part of what it is called any more. */
export function docName(filename) {
  const name = (filename ?? "").replace(/\.[^.]+$/, "").trim();
  return name || "Untitled";
}

/** The rule, kept apart from the build that configures it: Google is offered
 * when there is a client id to ask with, and never in the demo — its files are
 * invented, and inventing files in someone's real Drive demonstrates nothing. */
export const offered = (clientId, demo) => Boolean(clientId) && !demo;

/** Whether this build offers Google at all.
 *
 * Not in the iPhone app yet. Google refuses sign-in inside an embedded web view,
 * so the popup tab this rides on cannot work there; the app needs the consent to
 * go through ASWebAuthenticationSession instead. */
export function available() {
  return offered(CLIENT_ID, DEMO) && !NATIVE;
}

/* -------------------------------------------------------------------- token */

// Kept for the tab that is open, and no longer. An access token lasts an hour;
// re-asking costs a redirect the student has already consented to, which is a
// bounce they will not see, and that is cheaper than leaving a credential
// lying about in storage that outlives the session.
let held = null;

const valid = () => (held && held.expires > Date.now() + 30_000 ? held.token : null);

function keep(token, expiresIn) {
  held = { token, expires: Date.now() + (Number(expiresIn) || 3600) * 1000 };
}

/** Forget the token and tell Google to drop it. Called by "Disconnect Google"
 * and by logging out; the documents already in Drive are the student's and are
 * deliberately left alone. */
export async function disconnect() {
  const token = held?.token;
  held = null;
  if (!token) return;
  try {
    await fetch(`${REVOKE}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    // Dropping our copy is what disconnects this browser; the token expires on
    // its own within the hour whether or not Google was reachable to be told.
  }
}

/** Whether a Google session is live in this tab, for Settings to describe. */
export const connected = () => Boolean(valid());

/* --------------------------------------------------------------- the tab */

/**
 * The redirect target, which must match what is registered in the Google Cloud
 * console character for character.
 *
 * It names index.html rather than the directory: Vite's dev server answers a
 * bare directory under public/ with the app's own index.html, so `google/`
 * would come back as the dashboard and the relay would never run. Pages serves
 * either, so the explicit file is the one string that is right in both.
 */
export function redirectUri(href) {
  return new URL("google/index.html", href).toString();
}

function authUrl(href, job) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(href),
    response_type: "token",
    scope: SCOPE,
    state: job,
    include_granted_scopes: "true",
  });
  return `${AUTH}?${params}`;
}

/** A relay to the tab, and a promise for what it says back. */
function relay(job) {
  const channel = new BroadcastChannel(CHANNEL);
  const waiting = [];
  channel.onmessage = (e) => {
    if (e.data?.job !== job) return;
    const next = waiting.shift();
    if (next) next(e.data);
  };
  return {
    tell: (message) => channel.postMessage({ job, ...message }),
    /** The tab's next word, or a rejection if it never speaks. */
    hear: () => new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("The Google tab didn't answer. It may have been closed.")),
        PATIENCE_MS
      );
      waiting.push((data) => {
        clearTimeout(timer);
        resolve(data);
      });
    }),
    close: () => channel.close(),
  };
}

/* ------------------------------------------------------------------- drive */

async function drive(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401) {
    held = null;
    const stale = new Error("Google sign-in expired.");
    stale.expired = true;
    throw stale;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let said = "";
    try {
      said = JSON.parse(body)?.error?.message ?? "";
    } catch {
      said = body.slice(0, 200);
    }
    throw new Error(said || `Google refused the upload (${res.status}).`);
  }
  return res;
}

/**
 * The same handout, if it has been opened before.
 *
 * Reopening should land on the copy that has been written in, not a fresh blank
 * one. The file is recognised by a hash of its bytes, so a handout the
 * instructor has replaced is correctly a different document.
 *
 * Best-effort on purpose: whether drive.file may list what it created is not
 * something Google's documentation states, and a duplicate document is a far
 * smaller problem than a button that cannot open one.
 */
async function existing(token, hash) {
  try {
    const query = `appProperties has { key='whiteboard' and value='${hash}' } and trashed=false`;
    const url = `${FILES}?q=${encodeURIComponent(query)}&fields=files(id,webViewLink)&pageSize=1`;
    const found = await drive(token, url);
    return (await found.json()).files?.[0]?.webViewLink ?? null;
  } catch (e) {
    if (e.expired) throw e;
    return null;
  }
}

async function digest(blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function upload(token, blob, metadata) {
  const type = metadata.sourceType;
  const body = { name: metadata.name, mimeType: metadata.target,
                 appProperties: { whiteboard: metadata.hash } };
  const fields = "fields=id,webViewLink";

  if (blob.size <= MULTIPART_MAX) {
    const boundary = `whiteboard-${crypto.randomUUID()}`;
    const opening =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(body)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`;
    const res = await drive(token, `${UPLOAD}?uploadType=multipart&${fields}`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: new Blob([opening, blob, `\r\n--${boundary}--`]),
    });
    return (await res.json()).webViewLink;
  }

  // Above the multipart limit Drive wants a session, and the session URI comes
  // back in a Location header. Whether a browser is allowed to read that header
  // is not documented, so it is checked rather than assumed: a clear refusal
  // beats a broken PUT to `null`.
  const begun = await drive(token, `${UPLOAD}?uploadType=resumable&${fields}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8",
               "X-Upload-Content-Type": type,
               "X-Upload-Content-Length": String(blob.size) },
    body: JSON.stringify(body),
  });
  const session = begun.headers.get("Location");
  if (!session) {
    throw new Error(
      "Google accepted the upload but did not hand back a session this browser " +
      "can read, which it needs for a file this size. Download it and open it " +
      "in Drive by hand."
    );
  }
  const done = await fetch(session, { method: "PUT", headers: { "Content-Type": type }, body: blob });
  if (!done.ok) throw new Error(`The upload did not finish (${done.status}).`);
  return (await done.json()).webViewLink;
}

/* -------------------------------------------------------------------- open */

/**
 * Open one handout in Google Docs, Slides or Sheets.
 *
 * `getFile` is called for the bytes once the tab is already up, so the fetch
 * from Blackboard and the consent screen happen at the same time rather than
 * one after the other.
 *
 * The tab has to be opened in the click itself — a browser gives a gesture one
 * popup, and asking after an await gets nothing.
 */
export async function openInGoogle(filename, getFile) {
  if (!available()) throw new Error("Google isn't configured in this build.");
  const target = targetType(filename);
  if (!target) throw new Error(`Google can't open a ${suffix(filename) || "file"} like this.`);

  const href = location.href;
  const job = crypto.randomUUID();
  const post = relay(job);
  const tab = window.open(`${redirectUri(href)}?job=${job}`, "_blank");
  if (!tab) {
    post.close();
    throw new Error("Your browser blocked the new tab. Allow pop-ups for this site and try again.");
  }

  try {
    // The tab saying hello, before anything is sent to it.
    const hello = await post.hear();
    if (hello.error) throw new Error(hello.error);

    const wanted = getFile();

    const consent = async () => {
      post.tell({ type: "auth", url: authUrl(href, job) });
      const back = await post.hear();
      if (back.error) throw new Error(back.error);
      if (!back.token) throw new Error("Google did not return a sign-in.");
      keep(back.token, back.expires);
      return back.token;
    };

    let token = valid() ?? await consent();

    const file = await wanted;
    const blob = await (await fetch(file.url)).blob();
    const hash = await digest(blob);
    const metadata = { name: docName(file.filename ?? filename), target,
                       sourceType: sourceType(filename), hash };

    const send = async (using) =>
      (await existing(using, hash)) ?? (await upload(using, blob, metadata));

    let link;
    try {
      link = await send(token);
    } catch (e) {
      // A token that died between the check and the upload is worth one more
      // go; anything else is the answer.
      if (!e.expired) throw e;
      token = await consent();
      link = await send(token);
    }

    post.tell({ type: "go", url: link });
    return link;
  } catch (e) {
    post.tell({ type: "fail", message: e.message });
    throw e;
  } finally {
    post.close();
  }
}
