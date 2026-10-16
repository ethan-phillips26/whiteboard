# Whiteboard Claude host

What lets the **Claude** tab in [Whiteboard](https://ethanphillips.dev/whiteboard/) use the
Claude Code already on your computer. The Whiteboard Connector extension starts it (browser
native messaging) only while the Claude tab is open; nothing listens for the rest of the time.

```
Whiteboard page ⇄ Connector extension ⇄ host.mjs ⇄ your `claude`
                                           ▲
                      Claude's tools are the page's: it asks, the page answers
                      from the Blackboard session the browser already has.
```

The host never sees a Blackboard cookie, and knows nothing about Blackboard: the page sends
the list of tools Claude may use, Claude calls them through a local MCP endpoint (127.0.0.1,
random port, bearer token), and each call is passed up to the page. Claude itself runs with
every built-in tool off (`--tools ""`), no settings or hooks, in an empty temp directory.
It can read the student's courses through the page's tools and write documents and quizzes
for the page to show; it cannot run commands, touch files, or change anything in Blackboard.

## Install

Needs Node.js 18+ and Claude Code, signed in (run `claude` once). Linux, macOS and Windows.

```bash
node install.mjs <extension id>   # Chrome, Edge, Brave, Chromium: id from chrome://extensions
node install.mjs                  # Firefox and LibreWolf need no id
node install.mjs --uninstall
```

This writes a native-messaging manifest for each browser it finds, and records where `claude`
and `node` are (a browser starts the host with almost no `PATH`).

On Windows, run it from PowerShell or Command Prompt. Windows browsers find a host through
the registry, so it adds a key under `HKCU\Software\<vendor>\NativeMessagingHosts\` for each
browser installed (no administrator rights needed), pointing at a manifest in
`%APPDATA%\whiteboard-claude`. The native installer's `claude.exe` is the simplest to run; an
npm-installed `claude.cmd` is read for the script it runs and started directly, because a
shell would mangle the arguments. `--uninstall` removes the keys. The Windows path has not
been run on a real Windows machine; if it fails, the registry key and the manifest it points
at are the first things to check.

## Files

- `host.mjs` — the native host: framing, the claude child, the local MCP endpoint.
- `frames.mjs` — native messaging's 4-byte-length JSON framing.
- `install.mjs` — registers the host with the browsers.
- `platform.mjs` — what differs between Linux, macOS and Windows (kept pure, and tested).

Tested by `tests/test_claude_bridge.mjs` against a stand-in `claude`.
