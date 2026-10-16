// What differs between operating systems, kept as plain functions of their inputs so
// the Windows half can be tested on a machine that is not running Windows.

import os from "node:os";
import path from "node:path";

export const NAME = "dev.ethanphillips.whiteboard_claude";
export const isWin = process.platform === "win32";

/** Where the installer keeps its wrapper and the record of where `claude` is. */
export function stateDir({ win = isWin, env = process.env, home = os.homedir() } = {}) {
  return win
    ? path.win32.join(env.APPDATA || path.win32.join(home, "AppData", "Roaming"), "whiteboard-claude")
    : path.join(home, ".config", "whiteboard-claude");
}

/** Windows finds a native host through the registry, not a folder of manifests: a
 * key per browser whose default value is the path of a manifest file. `base` is the
 * browser's own profile folder, which says whether it is installed at all. */
export function windowsBrowsers(env = process.env) {
  const local = env.LOCALAPPDATA || "";
  const roaming = env.APPDATA || "";
  const w = path.win32;
  const entry = (browser, kind, base, vendorKey) => ({
    browser, kind, base,
    key: `HKCU\\Software\\${vendorKey}\\NativeMessagingHosts\\${NAME}`,
  });
  return [
    entry("Chrome", "chrome", w.join(local, "Google", "Chrome"), "Google\\Chrome"),
    entry("Chromium", "chrome", w.join(local, "Chromium"), "Chromium"),
    entry("Brave", "chrome", w.join(local, "BraveSoftware", "Brave-Browser"), "BraveSoftware\\Brave-Browser"),
    entry("Edge", "chrome", w.join(local, "Microsoft", "Edge"), "Microsoft\\Edge"),
    entry("Firefox", "firefox", w.join(roaming, "Mozilla", "Firefox"), "Mozilla"),
    // A Firefox fork; its own key is what its documentation names.
    entry("LibreWolf", "firefox", w.join(roaming, "librewolf"), "LibreWolf"),
  ];
}

/** A browser starts the file the manifest names directly, so on Windows it is a
 * batch file that runs the node and the host this installer was run with. `@echo off`
 * matters: anything the batch file itself prints would be read as a message. */
export function wrapperText({ win, node, host }) {
  return win
    ? `@echo off\r\n"${node}" "${host}"\r\n`
    : `#!/bin/sh\nexec "${node}" "${host}"\n`;
}

/** What an npm-installed `claude.cmd` runs: the file it hands to node, or the
 * executable it forwards to. Node will not start a .cmd without a shell, and a shell
 * makes the quotes in our arguments (JSON, prompts) unsafe, so the shim is read
 * instead and its target started directly. Null for a shim this cannot make sense of. */
export function shimTarget(text) {
  const found = [...String(text).matchAll(/%~?dp0%?\\?([^"\r\n%]+?\.(?:exe|js|mjs|cjs))/gi)];
  if (!found.length) return null;
  const file = found[found.length - 1][1];
  return { file, exe: /\.exe$/i.test(file) };
}

/** How to start `claude` given the path we found for it: `{cmd, pre}`, where `pre`
 * is whatever goes before our own arguments. Null when it cannot be started safely. */
export function launcher(bin, { win = isWin, read } = {}) {
  if (!win || !/\.(cmd|bat)$/i.test(bin)) return { cmd: bin, pre: [] };
  let text;
  try { text = read(bin); } catch { return null; }
  const t = shimTarget(text);
  if (!t) return null;
  const full = path.win32.join(path.win32.dirname(bin), t.file);
  return t.exe ? { cmd: full, pre: [] } : { cmd: process.execPath, pre: [full] };
}

/** Likely places for `claude` when neither the installer's record nor PATH has it. */
export function claudeCandidates({ win = isWin, env = process.env, home = os.homedir() } = {}) {
  if (win) {
    const w = path.win32;
    return [
      w.join(home, ".local", "bin", "claude.exe"),
      w.join(env.LOCALAPPDATA || "", "Programs", "claude", "claude.exe"),
      w.join(env.APPDATA || "", "npm", "claude.cmd"),
    ];
  }
  return [
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/bin/claude",
  ];
}
