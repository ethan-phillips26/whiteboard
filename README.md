# Whiteboard

A dashboard for Blackboard Learn: what's due, your grades in each course, announcements,
course materials and a calendar you can export. It only reads from Blackboard and never
submits or changes anything.

Unofficial, and not affiliated with Anthology Inc. Check your school's acceptable-use
policy before relying on it.

There are three ways to use it.

## 1. In the browser

Open <https://ethanphillips.dev/whiteboard/>. It needs the Whiteboard Connector
extension, which does the reading from Blackboard. See
[extension/README.md](extension/README.md) to install it.

Everything stays in your browser. Google Docs export isn't available here.

## 2. Desktop app

Windows, macOS and Linux. It signs you in through your school's normal login page.

Building it needs Python 3.12, [uv](https://docs.astral.sh/uv/), Node 22+ and Rust:

```bash
uv sync
npm ci
npm run app       # builds the app
npm run bundle    # installers go in src-tauri/target/release/bundle/
```

## 3. MCP server

Lets an AI agent answer questions like "what's due this week":

```bash
claude mcp add blackboard -- uv --directory /path/to/blackboard run blackboard-mcp
```

It has no way to sign in by itself. It uses the session the desktop app saved, or a
`BB_COOKIE` you set yourself (see below).

## Running the local server

```bash
uv sync
cd src/blackboard_web/frontend && npm ci && npm run build && cd -
uv run blackboard-web --open
```

This serves the dashboard at `http://127.0.0.1:8765`. Without the desktop app you need
to give it a session: log into Blackboard, open DevTools → Network, copy the `Cookie`
header from any request to your Blackboard site, and put it in `.env` as `BB_COOKIE`
along with `BB_HOST`.

## Configuration

`.env` lives in the app's data folder: `~/.local/share/blackboard` on Linux,
`~/Library/Application Support/blackboard` on macOS, `%APPDATA%\blackboard` on Windows.

| Setting | Purpose |
| --- | --- |
| `BB_HOST` | your school's Blackboard address |
| `BB_COOKIE` | your Blackboard session (the desktop app fills this in) |
| `BB_STATE_DIR` | use a different data folder |
| `BB_KEEPALIVE_MINUTES` | how often to keep the session alive (default 45) |
| `BB_GOOGLE_CLIENT_ID` / `BB_GOOGLE_CLIENT_SECRET` | optional, for "Open in Docs" |

## Grades

Blackboard doesn't say how much each category of a course is worth, so grades are
weighted by points until you enter the percentages from your syllabus in that course's
settings.

## Development

```bash
cd src/blackboard_web/frontend
npm run dev             # dashboard with hot reload (run `npm run server` from the root too)
npm run build:browser   # the browser version, into dist-browser/

uv run python tests/test_web.py
uv run python tests/test_grades.py
uv run python tests/test_end_to_end.py
```

The browser version is deployed to GitHub Pages by `.github/workflows/pages.yml` on every
push to `main`.
