#!/usr/bin/env node
// Registers the host with the browsers on this computer, so the Whiteboard
// Connector extension may start it. Run it once:
//
//   node install.mjs <extension id>        (Chrome, Edge, Brave: the id is on
//                                           chrome://extensions)
//   node install.mjs                       (Firefox and LibreWolf need no id)
//   node install.mjs <addon id>            (a copy of the extension with another id,
//                                           e.g. whiteboard-connector-local@ethanphillips.dev)
//   node install.mjs --uninstall
//
// Linux and macOS write a manifest into each browser's folder; Windows writes one
// manifest per kind and points a registry key at it, which is how Windows browsers
// find a native host.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAME, isWin, stateDir, windowsBrowsers, wrapperText } from "./platform.mjs";

const FIREFOX_ID = "whiteboard-connector@ethanphillips.dev";
const here = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const mac = process.platform === "darwin";

const args = process.argv.slice(2);
const uninstall = args.includes("--uninstall");
const ids = args.filter((a) => /^[a-p]{32}$/.test(a));
// The Firefox id is the add-on's own, which is how the page shows it too.
const addons = args.filter((a) => /^[^\s@]+@[^\s@]+$/.test(a));

const state = stateDir();

// [browser, kind, profile folder (says whether it is installed), where its manifest goes]
function unixBrowsers() {
  const support = mac ? path.join(home, "Library", "Application Support") : path.join(home, ".config");
  return [
    ["Chrome", "chrome", path.join(support, mac ? "Google/Chrome" : "google-chrome")],
    ["Chromium", "chrome", path.join(support, mac ? "Chromium" : "chromium")],
    ["Brave", "chrome", path.join(support, "BraveSoftware", "Brave-Browser")],
    ["Edge", "chrome", path.join(support, mac ? "Microsoft Edge" : "microsoft-edge")],
    ["Firefox", "firefox", mac ? path.join(support, "Mozilla") : path.join(home, ".mozilla")],
    // A Firefox fork with its own profile directory, so its hosts are looked for there.
    ["LibreWolf", "firefox", mac ? path.join(support, "LibreWolf") : path.join(home, ".librewolf")],
  ].map(([browser, kind, base]) => ({
    browser, kind, base,
    dir: path.join(base, kind === "firefox" && !mac ? "native-messaging-hosts" : "NativeMessagingHosts"),
  }));
}

const reg = (...a) => execFileSync("reg", a, { stdio: "ignore" });

if (uninstall) {
  if (isWin) {
    for (const b of windowsBrowsers()) {
      try { reg("delete", b.key, "/f"); console.log(`removed  ${b.browser}`); } catch { /* not there */ }
    }
  } else {
    for (const b of unixBrowsers()) {
      const file = path.join(b.dir, `${NAME}.json`);
      if (fs.existsSync(file)) { fs.rmSync(file); console.log(`removed  ${b.browser}`); }
    }
  }
  fs.rmSync(state, { recursive: true, force: true });
  process.exit(0);
}

// Where claude is, found the way the user's own shell would: a browser starts the
// host with too little PATH to find it again.
function findClaude() {
  try {
    if (isWin) {
      // Prefer a real executable: the first hit can be an npm .cmd shim.
      const hits = execFileSync("where", ["claude"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
      return hits.find((h) => /\.exe$/i.test(h)) ?? hits[0] ?? null;
    }
    const shell = process.env.SHELL || "/bin/sh";
    return execFileSync(shell, ["-lc", "command -v claude"], { encoding: "utf8" }).trim().split("\n").pop();
  } catch {
    return null;
  }
}
const claude = findClaude();
if (!claude) console.warn("Could not find `claude` on your PATH. Install Claude Code, then run this again.");

fs.mkdirSync(state, { recursive: true });
fs.writeFileSync(path.join(state, "config.json"), JSON.stringify({ claude }, null, 2));
// A browser runs the file named in the manifest directly, so it has to be one
// executable; this pins the node that ran the installer and the host beside it.
const wrapper = path.join(state, isWin ? "whiteboard-claude-host.cmd" : "whiteboard-claude-host");
fs.writeFileSync(wrapper,
  wrapperText({ win: isWin, node: process.execPath, host: path.join(here, "host.mjs") }), { mode: 0o755 });

const manifest = (kind) => ({
  name: NAME,
  description: "Lets the Whiteboard Connector talk to Claude Code on this computer.",
  path: wrapper,
  type: "stdio",
  ...(kind === "firefox"
    ? { allowed_extensions: [...new Set([FIREFOX_ID, ...addons])] }
    : { allowed_origins: ids.map((id) => `chrome-extension://${id}/`) }),
});

let wrote = 0;
for (const b of isWin ? windowsBrowsers() : unixBrowsers()) {
  if (!fs.existsSync(b.base)) continue;
  if (b.kind === "chrome" && !ids.length) {
    console.log(`skipped  ${b.browser} (needs the extension id from its extensions page)`);
    continue;
  }
  if (isWin) {
    const file = path.join(state, `${b.kind}-host.json`);
    fs.writeFileSync(file, JSON.stringify(manifest(b.kind), null, 2));
    try {
      reg("add", b.key, "/ve", "/t", "REG_SZ", "/d", file, "/f");
    } catch (e) {
      console.log(`failed   ${b.browser}: could not write the registry key (${e.message.split("\n")[0]})`);
      continue;
    }
  } else {
    fs.mkdirSync(b.dir, { recursive: true });
    fs.writeFileSync(path.join(b.dir, `${NAME}.json`), JSON.stringify(manifest(b.kind), null, 2));
  }
  console.log(`installed  ${b.browser}`);
  wrote++;
}
if (!wrote) console.log("No browser was set up. Give a Chrome-family extension id, or install Firefox.");
