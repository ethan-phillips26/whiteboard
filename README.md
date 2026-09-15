# Whiteboard

A dashboard for Blackboard Learn: what's due, your grades in each course, announcements,
course materials and a calendar you can export. It runs entirely in your browser and
only reads from Blackboard. It never submits or changes anything.

Unofficial, and not affiliated with Anthology Inc. Check your school's acceptable-use
policy before relying on it.

## Use it

Open <https://ethanphillips.dev/whiteboard/>. It needs the Whiteboard Connector
extension, which does the reading from Blackboard. The page offers it as a download,
and [extension/README.md](extension/README.md) explains how to install it.

Your data stays in your browser.

## Grades

Blackboard doesn't say how much each category of a course is worth, so grades are
weighted by points until you enter the percentages from your syllabus in that course's
settings.

## Development

```bash
npm ci
npm run dev     # local server with hot reload
npm run build   # the site, into dist/
npm test
```

The published extension only works with the live site. For local work, load a copy of
`extension/` with `http://localhost/*` added to the content script's `matches` in
`manifest.json` and to `PAGES` in `background.js`. Don't publish that copy.

Pushing to `main` deploys the site to GitHub Pages (`.github/workflows/pages.yml`).
