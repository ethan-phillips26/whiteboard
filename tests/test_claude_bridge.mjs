/**
 * The native host the Claude tab talks to, run for real against a stand-in
 * `claude`: the wire framing, the locked-down flags, a tool call making the whole
 * round trip (Claude → local MCP → page → back), and the one-off ask that grades.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decoder, encode } from "../claude-bridge/frames.mjs";

const fails = [];
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}` + (cond ? "" : `  — ${detail}`));
  if (!cond) fails.push(label);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-bridge-"));
const argvFile = path.join(dir, "argv.json");
const fake = path.join(dir, "claude");
fs.writeFileSync(fake, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9-fake"); process.exit(0); }
require("fs").appendFileSync(process.env.FAKE_ARGV, JSON.stringify(args) + "\\n");
const chat = args.includes("--input-format");
let input = "";
if (chat) {
  const cfg = JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers.whiteboard;
  const post = async (body) => (await fetch(cfg.url, { method: "POST", headers: { ...cfg.headers, "content-type": "application/json" }, body: JSON.stringify(body) }));
  process.stdin.on("data", async (d) => {
    input += d;
    if (!input.includes("\\n")) return;
    const text = JSON.parse(input.split("\\n")[0]).message.content;
    input = "";
    await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const list = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    const call = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text } } })).json();
    const bad = await fetch(cfg.url, { method: "POST", body: "{}" });
    const out = { names: list.result.tools.map((t) => t.name), tool: call.result.content[0].text, unauth: bad.status };
    console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: JSON.stringify(out) } } }));
    console.log(JSON.stringify({ type: "assistant", message: { content: [] } }));
    console.log(JSON.stringify({ type: "result", is_error: false, subtype: "success", result: "ok" }));
  });
} else {
  process.stdin.on("data", (d) => { input += d; });
  process.stdin.on("end", () => console.log(JSON.stringify({ is_error: false, structured_output: { got: input, schema: args.includes("--json-schema") } })));
}
`, { mode: 0o755 });

const host = spawn(process.execPath, ["claude-bridge/host.mjs"], {
  env: { ...process.env, WHITEBOARD_CLAUDE_BIN: fake, FAKE_ARGV: argvFile },
  stdio: ["pipe", "pipe", "inherit"],
});
const inbox = [];
host.stdout.on("data", decoder((m) => inbox.push(m)));
const send = (m) => host.stdin.write(encode(m));

async function next(pred, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const i = inbox.findIndex(pred);
    if (i >= 0) return inbox.splice(i, 1)[0];
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 20));
  }
}

console.log("\n[bridge] hello");
const hello = await next((m) => m.t === "hello");
check("it greets with the claude it found", hello?.ok === true && hello.claude === "9.9.9-fake",
      JSON.stringify(hello));

console.log("\n[bridge] a chat turn");
send({ t: "start", system: "be brief", model: "sonnet", effort: "medium",
       tools: [{ name: "echo", description: "x", inputSchema: { type: "object" } }] });
send({ t: "user", text: "hello there" });
const call = await next((m) => m.t === "tool_call");
check("Claude's tool call is passed up to the page",
      call?.name === "echo" && call.args?.text === "hello there", JSON.stringify(call));
send({ t: "tool_result", id: call.id, text: "page says hi" });
const delta = await next((m) => m.t === "event" && m.event?.type === "content_block_delta");
const out = JSON.parse(delta?.event?.delta?.text ?? "{}");
check("the page's answer reaches Claude", out.tool === "page says hi", JSON.stringify(out));
check("the tools it was offered are the page's own", out.names?.[0] === "echo", JSON.stringify(out));
check("the local endpoint refuses a caller without the token", out.unauth === 401, String(out.unauth));
const result = await next((m) => m.t === "event" && m.event?.type === "result");
check("the end of the turn is reported", result?.event?.is_error === false);
check("whole assistant messages are not forwarded twice",
      !inbox.some((m) => m.event?.type === "assistant"));

const argv = fs.readFileSync(argvFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const flags = argv.find((a) => a.includes("--input-format")) ?? [];
const after = (f) => flags[flags.indexOf(f) + 1];
check("every built-in tool is switched off", after("--tools") === "", JSON.stringify(flags));
check("only the page's tools are allowed", after("--allowedTools") === "mcp__whiteboard");
check("nothing outside the allow list is asked about", after("--permission-mode") === "dontAsk");
check("only the page's MCP server is loaded", flags.includes("--strict-mcp-config"));
check("the system prompt and model are passed on",
      after("--system-prompt") === "be brief" && after("--model") === "sonnet");
check("and how hard it should think", after("--effort") === "medium");

console.log("\n[bridge] an ask (grading)");
send({ t: "ask", id: 7, prompt: "grade this", schema: { type: "object" }, model: "--dangerous", effort: "bogus" });
const ans = await next((m) => m.t === "answer");
check("the answer comes back under its id with the structured result",
      ans?.id === 7 && ans.result?.got === "grade this" && ans.result.schema === true,
      JSON.stringify(ans));
const argv2 = fs.readFileSync(argvFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const asked = argv2.find((a) => !a.includes("--input-format") && a.includes("--json-schema")) ?? [];
check("a model or effort that is not one is not passed on",
      !asked.includes("--dangerous") && !asked.includes("--model") && !asked.includes("--effort"), JSON.stringify(asked));
check("an ask has no tools and no history", asked[asked.indexOf("--tools") + 1] === ""
      && asked.includes("--no-session-persistence"));

console.log("\n[bridge] ending");
const closed = new Promise((r) => host.on("close", r));
host.stdin.end();
const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r("timeout"), 4000))]);
check("closing the port ends the host", code === 0, String(code));

fs.rmSync(dir, { recursive: true, force: true });
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
