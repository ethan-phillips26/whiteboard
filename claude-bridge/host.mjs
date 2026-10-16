#!/usr/bin/env node
// The Whiteboard Claude host: what the Whiteboard Connector extension starts, over
// native messaging, so the Claude tab can talk to the `claude` already installed
// and signed in on this computer.
//
// It knows nothing about Blackboard. The page sends the tools it wants Claude to
// have; Claude calls them over a local MCP endpoint this process serves; each call
// is passed straight back up to the page, which answers it from the session it
// already holds. Nothing here reads a cookie, a file or a course.
//
// Claude runs with every built-in tool switched off and only those page tools
// allowed, in an empty directory, so a hostile line in a course announcement can
// at worst make it say something wrong — it has no shell to reach.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { decoder, encode } from "./frames.mjs";
import { claudeCandidates, launcher, stateDir } from "./platform.mjs";

export const VERSION = 1;
const MCP_NAME = "whiteboard";
// Chrome refuses a message from a host above 1 MB.
const MAX_OUT = 900 * 1024;
const TOOL_TIMEOUT = 180_000;
const ASK_TIMEOUT = 180_000;

const stdout = process.stdout;
function post(msg) {
  let frame = encode(msg);
  if (frame.length > MAX_OUT) frame = encode({ t: "oversize", of: msg.t });
  stdout.write(frame);
}

/* ------------------------------------------------------------ finding claude */

function configured() {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(), "config.json"), "utf8")).claude || null;
  } catch {
    return null;
  }
}

// A browser starts a native host with almost no PATH, so the usual place a user's
// claude lives is not on it. The installer records where it found one; these are
// the fallbacks.
function claudeBin() {
  if (process.env.WHITEBOARD_CLAUDE_BIN) return process.env.WHITEBOARD_CLAUDE_BIN;
  const candidates = [configured(), ...claudeCandidates()].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? "claude";
}

// How to start it. Normally just the path; on Windows an npm-installed `claude.cmd` is
// read for what it runs, because a shell would mangle the JSON and prompts we pass.
let start = null;
const startClaude = (args, options) => spawn(start.cmd, [...start.pre, ...args], options);

function version() {
  return new Promise((resolve) => {
    if (!start) return resolve(null);
    const child = startClaude(["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? out.trim() : null));
  });
}

const sandbox = path.join(os.tmpdir(), "whiteboard-claude");
fs.mkdirSync(sandbox, { recursive: true });

// The flags that make Claude a study assistant rather than a coding agent. `--tools ""`
// removes every built-in; `dontAsk` refuses whatever is not on the allow list rather
// than prompting nobody; no settings are read, so no hooks run.
function lockedDown(extra = []) {
  return [
    "-p", "--tools", "", "--permission-mode", "dontAsk",
    "--setting-sources", "project", "--disable-slash-commands",
    "--no-session-persistence", ...extra,
  ];
}

// The page chooses the model and how hard it thinks. Both end up as one argument each
// (never through a shell), but they are still only passed on if they look like what
// they are, so a page cannot slip a flag in as a "model".
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const choice = ({ model, effort }) => [
  ...(typeof model === "string" && /^[A-Za-z0-9][\w.\-[\]]{0,79}$/.test(model) ? ["--model", model] : []),
  ...(EFFORTS.includes(effort) ? ["--effort", effort] : []),
];

/* ------------------------------------------------------------- the tools MCP */

const token = crypto.randomBytes(24).toString("hex");
let pageTools = [];
let nextCall = 0;
const calls = new Map();

function callPage(name, args) {
  return new Promise((resolve) => {
    const id = ++nextCall;
    const timer = setTimeout(() => {
      calls.delete(id);
      resolve({ content: [{ type: "text", text: "The page did not answer in time." }], isError: true });
    }, TOOL_TIMEOUT);
    calls.set(id, (r) => { clearTimeout(timer); resolve(r); });
    post({ t: "tool_call", id, name, args });
  });
}

async function rpc(req) {
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: req.params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: MCP_NAME, version: String(VERSION) },
      };
    case "tools/list":
      return { tools: pageTools };
    case "tools/call":
      return callPage(req.params?.name, req.params?.arguments ?? {});
    case "ping":
      return {};
    default:
      return undefined;
  }
}

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith("/mcp")) {
    res.writeHead(405).end();
    return;
  }
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", async () => {
    let msg;
    try { msg = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    if (msg.id === undefined) { res.writeHead(202).end(); return; }  // a notification
    const result = await rpc(msg);
    const reply = result === undefined
      ? { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } }
      : { jsonrpc: "2.0", id: msg.id, result };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
  });
});

const listening = new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

/* ------------------------------------------------------------------- a chat */

let chat = null;
let bin = null;
let starting = Promise.resolve();

function stopChat() {
  if (!chat) return;
  const child = chat;
  chat = null;
  child.removeAllListeners("close");
  // Whatever it had left to say is not wanted: the page has moved on.
  child.stdout.removeAllListeners("data");
  child.kill();
}

// Only what the page draws: text and tool-use as they stream, and how a turn ended.
// Everything else Claude emits — the whole message again, rate limits, usage — is
// noise to a screen and, for the first, would double the bytes.
function forward(line) {
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  if (ev.type === "stream_event" || ev.type === "result") {
    post({ t: "event", event: ev.type === "result"
      ? { type: "result", is_error: !!ev.is_error, subtype: ev.subtype, result: ev.result }
      : ev.event });
  }
}

async function startChat({ system, tools, model, effort }) {
  stopChat();
  await listening;
  pageTools = Array.isArray(tools) ? tools : [];
  const mcp = { mcpServers: { [MCP_NAME]: {
    type: "http",
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    headers: { Authorization: `Bearer ${token}` },
  } } };
  const args = [
    ...lockedDown(),
    "--input-format", "stream-json", "--output-format", "stream-json",
    "--include-partial-messages", "--verbose",
    "--strict-mcp-config", "--mcp-config", JSON.stringify(mcp),
    "--allowedTools", `mcp__${MCP_NAME}`,
    ...(system ? ["--system-prompt", system] : []),
    ...choice({ model, effort }),
  ];
  const child = startClaude(args, { cwd: sandbox, stdio: ["pipe", "pipe", "pipe"] });
  chat = child;
  let tail = "";
  let pending = "";
  child.stdout.on("data", (d) => {
    pending += d;
    let i;
    while ((i = pending.indexOf("\n")) >= 0) {
      forward(pending.slice(0, i));
      pending = pending.slice(i + 1);
    }
  });
  child.stderr.on("data", (d) => { tail = (tail + d).slice(-2000); });
  child.stdin.on("error", () => {});
  child.on("error", (e) => {
    if (chat === child) chat = null;
    post({ t: "exit", code: null, detail: String(e.message) });
  });
  child.on("close", (code) => {
    if (chat === child) chat = null;
    post({ t: "exit", code, detail: tail.trim() });
  });
}

/* ------------------------------------------------------------ a one-off ask */

// Grading: a fresh Claude with no tools and no history, asked for JSON against a
// schema. It never sees the conversation, which is what keeps a student's answer
// from steering it with anything said earlier.
function ask({ id, prompt, system, schema, model, effort }) {
  const args = [
    ...lockedDown(["--output-format", "json"]),
    ...(schema ? ["--json-schema", JSON.stringify(schema)] : []),
    ...(system ? ["--system-prompt", system] : []),
    ...choice({ model, effort }),
  ];
  const child = startClaude(args, { cwd: sandbox, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  const done = (msg) => { clearTimeout(timer); post({ t: "answer", id, ...msg }); };
  const timer = setTimeout(() => { child.kill(); }, ASK_TIMEOUT);
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  child.stdin.on("error", () => {});
  child.on("error", (e) => done({ error: String(e.message) }));
  child.on("close", () => {
    try {
      const j = JSON.parse(out);
      if (j.is_error) done({ error: String(j.result || "Claude reported an error.") });
      else done({ result: j.structured_output ?? j.result ?? null });
    } catch {
      done({ error: err.trim() || "Claude gave no answer." });
    }
  });
  child.stdin.end(String(prompt ?? ""));
}

/* ------------------------------------------------------------------ the pipe */

process.stdin.on("data", decoder((msg) => {
  switch (msg?.t) {
    case "start":
      starting = startChat(msg).catch((e) => post({ t: "exit", code: null, detail: String(e.message) }));
      break;
    case "user":
      // The page sends its first line right behind `start`, before the child exists.
      starting.then(() => {
        if (chat) {
          chat.stdin.write(JSON.stringify({
            type: "user", message: { role: "user", content: String(msg.text ?? "") },
          }) + "\n");
        } else {
          post({ t: "exit", code: null, detail: "No conversation is running." });
        }
      });
      break;
    case "stop": stopChat(); break;
    case "tool_result": {
      const done = calls.get(msg.id);
      if (done) {
        calls.delete(msg.id);
        done({ content: [{ type: "text", text: String(msg.text ?? "") }], isError: !!msg.isError });
      }
      break;
    }
    case "ask": ask(msg); break;
    default: break;
  }
}));

// The browser closing the port is how this ends: no chat outlives its page.
let closing = false;
const finish = () => {
  if (closing) return;
  closing = true;
  stopChat();
  server.close();
  process.exit(0);
};
process.stdin.on("end", finish);
process.stdin.on("close", finish);

bin = claudeBin();
start = launcher(bin, { read: (f) => fs.readFileSync(f, "utf8") });
version().then((v) => post(v
  ? { t: "hello", ok: true, host: VERSION, claude: v }
  : { t: "hello", ok: false, host: VERSION, reason: "claude-missing" }));
