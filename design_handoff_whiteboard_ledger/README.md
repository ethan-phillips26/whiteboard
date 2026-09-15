# Handoff: Whiteboard — “Ledger” visual redesign

## Overview

A full visual redesign of **Whiteboard**, a read-only, browser-only dashboard over Blackboard Learn.
This bundle covers the chosen direction — **“Ledger”** — and the **Overview (dashboard) screen** in that
direction, layout `3a`, plus two alternate Overview layouts (`2a`, `2b`, `2c`) and the two rejected visual
directions (`1b`, `1c`) for context.

The redesign changes nothing about structure, content or behaviour. Routing, data, overlays, demo data and
the “never writes to Blackboard” rule are all as they are today. What changes is the visual language:
warm paper surfaces, hairline rules instead of card shadows, a serif display face for titles, and **every
number set in mono with tabular figures** so dates, points and scores align in columns.

## About the design files

`Whiteboard Redesign.dc.html` in this bundle is a **design reference written in HTML** — a prototype showing
the intended look, not production code to copy. The task is to **recreate the design in the Whiteboard
codebase** (React + one hand-written CSS file, no UI framework, no Tailwind) using the token → primitive →
screen structure described below. Class names in this document are suggestions that match that structure;
follow whatever conventions the repo already uses where they conflict.

The file is a single-file streaming component: open it in a browser and it renders. Inside it, each design
option is wrapped in `<div class="dv-opt" id="3a">` etc., so `#3a` in the URL scrolls to the approved layout.
Inline styles there are an artefact of the prototyping environment — in production they become the CSS file
in `whiteboard.css` (included in this bundle as a starting point).

## Fidelity

**High fidelity** for the Overview screen, light theme, at 1440 wide. Colours, type sizes, spacing and
border treatment are final and should be reproduced exactly.

**Not yet designed** (do not invent — these are queued design work):
dark theme applied to a real screen, phone/tablet widths, the connect/sign-in states, assignment drawer,
document viewer, day modal, new-announcements modal, course page and its four tabs, all-grades, all-announcements,
settings and course settings. Dark-theme *tokens* are final and included; the eight course hues are final in
both themes.

---

## Design tokens

Set on `:root`; the dark block applies under `[data-theme="dark"]` and under
`@media (prefers-color-scheme: dark)` when the user has chosen “match system”.

### Surfaces and ink

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f7f4ed` | `#191710` | app background |
| `--panel` | `#fffdf8` | `#211e16` | panel / sheet fill, calendar cells |
| `--sunk` | `#efeade` | `#13110c` | sidebar background |
| `--hover` | `#f1ead6` | `#262218` | row and cell hover |
| `--rule` | `#ddd7c9` | `#332e22` | hairlines, panel borders, grid lines |
| `--rule-soft` | `#eee7d8` | `#2a251b` | row dividers inside a list |
| `--ink` | `#1c1a17` | `#f2ede0` | primary text; also the primary-button fill (light) |
| `--ink-2` | `#4a463e` | `#c3bca9` | secondary text, nav links at rest |
| `--ink-3` | `#8d8778` | `#8f8878` | muted meta, micro-caps labels |
| `--ink-4` | `#b3ab97` | `#5f5a4c` | disabled text, neighbouring-month dates |
| `--link` | `#2b5f8f` | `#78b0dd` | links and the focus ring |
| `--ok` | `#2f7a6a` | `#5fc0ab` | “nothing missed”, good calculator result |
| `--warn` | `#8a6a12` | `#dcae52` | due soon |
| `--danger` | `#a33c28` | `#e8836b` | overdue, destructive actions |

On the ink band (the countdown block) text is `--paper` / `#f7f4ed`, its muted text is `#9a917c`, its
secondary text `#c9c2ae`, and its internal rules `#35312a`. In dark theme the band inverts: fill `#f2ede0`
with `#191710` text. Contrast: `--ink-3` on `--panel` is 4.6:1; `--ink-4` is used only for non-essential
dimmed dates, never for text carrying meaning.

### Pill tones (relative-due pill, flags, count pills)

| Tone | Light fg / bg / border | Dark fg / bg / border |
|---|---|---|
| overdue | `#8e2f22` / `#f8e7e1` / `#e6c3b7` | `#ffd9cd` / `#3d211a` / `#5d3225` |
| soon (≤3 days) | `#7a5a12` / `#f7efdb` / `#e3d3a8` | `#f2dca6` / `#332a15` / `#4e401f` |
| later | `#4a463e` / `#f3eee1` / `#ddd7c9` | `#c3bca9` / `#262218` / `#332e22` |
| ok | `#20604f` / `#e4efe9` / `#bcd6cb` | `#b6e7db` / `#16302a` / `#255043` |

### The 8 course hues

Eight categorical slots, assigned by **sorted course name**, never cycled, so a course keeps its colour on
every screen and across themes. Colour is always printed beside the course name or code and never carries
meaning alone.

| Slot | Name | Light | Dark |
|---|---|---|---|
| 1 | rust | `#b1543a` | `#e08a6b` |
| 2 | amber | `#a8792a` | `#d9ab5c` |
| 3 | olive | `#5f7a2e` | `#98bd63` |
| 4 | teal | `#2f7a6a` | `#5fc0ab` |
| 5 | slate | `#2e6b96` | `#6fb0e0` |
| 6 | indigo | `#5a5aa8` | `#9a97e8` |
| 7 | plum | `#8f4a82` | `#d288c0` |
| 8 | clay | `#8a5a3c` | `#c79a74` |

Slot 1 (rust) sits nearest the overdue red and slot 4 (teal) nearest the good green, so **neither is used as
a state colour anywhere**. Dark hues are the same hues re-stepped lighter for a dark surface, not inverted.

### Typography

Google Fonts: `Instrument Serif` (400, and 400 italic), `IBM Plex Sans` (400/500/600),
`IBM Plex Mono` (400/500/600). Fallbacks: `Georgia, serif` / `system-ui, sans-serif` / `ui-monospace, Menlo, monospace`.

| Role | Font | Size / line-height / weight | Notes |
|---|---|---|---|
| Page title | Instrument Serif | 32 / 1.0 / 400 | “Welcome back, Jordan” |
| Panel title | Instrument Serif | 23 / 1.0 / 400 | “September 2026”, “Deadlines” |
| Sub-panel title | Instrument Serif | 18–21 / 1.0 / 400 | rail headings |
| Item title | IBM Plex Sans | 15.5 / 1.3 / 600 | drawer + hero item title |
| Row title | IBM Plex Sans | 13.5 / 1.25 / 500 | deadline rows |
| Body | IBM Plex Sans | 13.5 / 1.55 / 400 | instructions, announcement text |
| UI / buttons | IBM Plex Sans | 12–13 / 1.0 / 500 | |
| Hero numeral | IBM Plex Mono | 50 / 0.9 / 600, `letter-spacing:-2.5px` | countdown |
| Tile numeral | IBM Plex Mono | 28 / 1.0 / 600 | stat figures |
| Numeric meta | IBM Plex Mono | 10.5–11.5 / 1.0–1.3 / 400 | dates, times, points, counts |
| Micro caps | IBM Plex Mono | 9 / 1.0 / 500, `letter-spacing:.11em`, uppercase | section and tile labels |

`font-variant-numeric: tabular-nums` on **every** element containing a number. The micro-caps labels are
set in mono uppercase with real tracking — they are the only uppercase in the design.

### Spacing, radius, elevation, motion

- Spacing scale: **4, 8, 12, 16, 24, 32, 48**. Main padding `22px 26px 24px`; panel padding `12px 14px`;
  row padding `10px 8px 11px 12px`; gap between the calendar column and the deadline rail `20px`.
- Radius: **0** for rows, calendar cells and the ink band; **2px** for panels and buttons; **4px** for inputs.
  Nothing is pill-shaped except count pills (`999px`).
- Elevation: **none**. Hairlines only. The single shadow in the system is for overlays —
  `-10px 0 28px rgba(40,34,20,.14)` on the drawer, and the same spread centred for modal/viewer.
- Motion: 140ms `ease` fade for scrims, 200ms `ease-out` translate for the drawer. Nothing else animates.
  Wrap both in `@media (prefers-reduced-motion: reduce)` and drop to an instant state change.
- Focus: `outline: 2px solid var(--link); outline-offset: 2px`. Never remove it; row-shaped buttons take the
  same ring on their full width.

---

## Screen: Overview (`#/`) — layout `3a`

**Purpose.** Answers “what is due, and when?” in one screenful. On ≥1081×780 the whole screen fits with no
page scroll: header, ink band, calendar and deadline rail read together, and only the deadline rail scrolls
inside its own panel.

**Layout.** Two-column app shell: `aside` fixed `216px` (was 230 — tightened) on `--sunk` with a
`1px solid var(--rule)` right edge, then `main` at `flex:1; min-width:0`, padding `22px 26px 24px`,
`display:flex; flex-direction:column; gap:16px`. Inside `main`, three stacked blocks:

1. **Header** — `display:flex; align-items:flex-end`. Left: page title (Instrument Serif 32) and under it,
   `SUN 13 SEP 2026 · SYNCED 10:42 AM` in micro-caps mono `11.5px` `--ink-3`. Right, pushed by `margin-left:auto`:
   `Export .ics` (default button) and `Sync now` (primary). While syncing, the primary keeps its width, shows a
   10px spinner and the label `Syncing`.
2. **Ink band** — full-width `background:var(--ink); color:var(--paper)`, no radius, `display:flex`.
   Left region (`flex:1`, padding `16px 20px 17px`): `NEXT DEADLINE` micro-caps, then the countdown —
   mono 50px 600 numeral with `days left` beside it in Plex Sans 15 `#c9c2ae` — then, separated by a
   `1px solid #35312a` left rule and `20px` padding, the item title (Plex Sans 15.5/600, ellipsised) and a meta
   line: 9px course-colour square + `CSCI 467 · TUE 15 SEP 11:59 PM · 50 PT` in mono 11px `#c9c2ae`.
   Right region: three stat cells, each `min-width:132px`, padding `16px 20px 17px`, divided by
   `1px solid #35312a` left rules — **Due this week** `5` “next 7 days”, **Overdue** `1` “PS 4: Reductions”
   (figure in `--danger`; when zero the note becomes “nothing missed” and the figure goes `--ok`),
   **Grade so far** `91.4%` “A · 5 gradebooks visible”. There is deliberately **no “Courses” tile and no
   “at stake this week” tile** — both were cut as uninformative.
   Countdown variants, all same slot: `2 days left`, `5 hours left`, `40 minutes left`, and the late form
   `3 hours ago`. Empty state: `0 outstanding · Nothing is due in the sync window.`
3. **Body grid** — `grid-template-columns: 1fr 352px; gap:20px; align-items:start`.

**Calendar column.** A `2px solid var(--ink)` heading rule under: “September” (Instrument Serif 23, year in
`--ink-3`), `12 DUE THIS MONTH` in mono micro-caps, and right-aligned `‹ TODAY ›` as three joined
1px-bordered buttons. Weekday row: mono 9px micro-caps, `--ink-3`, Sunday first, left-aligned with 3px inset.
Grid: `repeat(7,1fr)`, 6 rows, `border-top`+`border-left` on the container and `border-right`+`border-bottom`
on each cell so rules never double. Cells `min-height:98px`, padding `6px 7px 7px`, fill `--panel`; today
`--hover`; neighbouring-month cells `--paper` with the date in `--ink-4`. Date numeral mono 12px 500.
Up to **three chips** per cell: no dot — each chip is a `box-shadow: inset 2px 0 0 <course hue>` with `6px`
left padding and the title in Plex Sans 10.5/1.3 `--ink-2`, ellipsised. Past items at `opacity:.45`. Overflow
line `+2 more` in mono 10px `--ink-3`, pushed to the bottom with `margin-top:auto`.
**A cell with items is one `<button>`**; the chips inside are inert `<span>`s — no nested interactives. Clicking
it opens the day modal. Below the grid, the legend: one bordered toggle per course with work in view
(7px colour square + label in mono 11px), pressed state = `border-color:var(--ink); color:var(--ink)`, then a
`SHOW ALL COURSES` text link.

**Deadline rail.** Same `2px solid var(--ink)` heading rule: “Deadlines” + `14 OUTSTANDING`. The list is a
column of full-width row buttons, never truncated, soonest first with overdue at the top; the container is
`max-height:648px; overflow:auto` with a `36px` bottom gradient fade from `--paper`. Each row:
`box-shadow: inset 3px 0 0 <course hue>`, `border-bottom:1px solid var(--rule-soft)`, padding
`10px 8px 11px 12px`, hover `--hover`. Contents: title (Plex Sans 13.5/500, ellipsised) with an optional
`NEW` badge (mono 8.5px micro-caps, `--ink` fill, `--paper` text, 2×4px padding) when first seen in the last
24h; a meta line `CSCI 467 · Tue, Sep 15 11:59 PM · 50 pt` in mono 10.5px `--ink-3`; and right-aligned, the
relative-due pill in one of the three tones. Rows open the assignment drawer. Empty state:
`Nothing outstanding in the next 60 days.`

**Sidebar.** Brand (22px ink mark — three white rules of 14/9/12px on an ink square — plus “Whiteboard” in
Instrument Serif 19 and a `DEMO` micro-caps flag with a 1px border). Nav links at `8px 16px`, Plex Sans 13;
the active link gets `background:var(--paper)` and `box-shadow: inset 3px 0 0 var(--ink)`. Announcements
carries a solid ink count pill, Grades a plain mono count in `--ink-3`. A `COURSES` micro-caps group label,
then one link per course: 9px colour square + label in **mono 12.5px** (course codes are numeric — mono keeps
them aligned), `title` attribute for the full name, ellipsis on overflow. `Settings` pinned with
`margin-top:auto`. Footer above a hairline: student name (Plex Sans 12/500) and `Exit demo` / `Log out`.

**Responsive.** Below 1081 the body grid collapses to one column (calendar first) and the page scrolls; the
rail loses its max-height and fade. Below 900 the sidebar becomes a sticky top bar: brand fixed at the left,
nav links and course links in one horizontally scrolling strip with a `--paper` fade at the right edge, and
`Log out` pinned right. Below ~560 calendar cells drop chips entirely and show only `2 due` in mono 11px,
opening the same day modal. Nothing scrolls horizontally at any width; only wide tables and code blocks
scroll inside their own container.

---

## Interactions and behaviour

Unchanged from the current app, restated so the CSS covers every state:

- **Sync now** → spinner + `Syncing` label, button stays disabled; on failure an inline error banner appears
  above the ink band (1px `--danger` border, `--danger` text on a `#f8e7e1` fill, with a `Try again` link).
  No toasts anywhere in the app — all status is inline.
- **Export .ics** downloads immediately, no state change.
- **Calendar cell** → day modal. **Deadline row** → assignment drawer. **Legend toggle** → filters the grid,
  pressed state as above, `SHOW ALL COURSES` clears it.
- Escape is handled by the topmost overlay only.
- Boot states: full-screen centred spinner with `Checking Blackboard session…` or `Loading coursework…` in
  Plex Sans 13.5 `--ink-2` beneath it.
- Loading, empty and error states for the dashboard are named above; Materials and drawer states are listed
  in the brief and still need design.

## State

No new state. Existing: sync status and last-synced time, the outstanding-deadline list, first-seen
timestamps driving the `NEW` badge, the visible calendar month, the legend's course filter, the unread
announcement count, and the theme choice (`light` / `dark` / `system`) persisted locally.

## Assets

No image assets. The mark is CSS only: a 22px `--ink` square with three absolutely-positioned `--paper` rules
(14×2 at 4,4 · 9×2 at 4,10 · 12×2 at 4,16). Icons are text characters — `‹ › → ↗ ↓ ⌕` and a caret — as today.
Fonts load from Google Fonts with the system fallbacks listed above.

## Files in this bundle

- `README.md` — this document.
- `whiteboard.css` — starting-point stylesheet: tokens (light + dark + system), then primitives. Written to
  match the repo's stated tokens → primitives → screens structure. Screen-level rules are not included; build
  them from the Overview description above.
- `Whiteboard Redesign.dc.html` — the design reference. Open in a browser; `#3a` is the approved Overview
  layout, `#2a`/`#2b`/`#2c` are alternate layouts in the same visual language, `#1b`/`#1c` are the rejected
  directions. Ignore its inline styles and its `<sc-for>` template syntax; read it for measurements and colour.

## Suggested build order

1. Drop the tokens block from `whiteboard.css` into the stylesheet and convert existing components to the new
   variable names. The app should already look ~60% redesigned at this point.
2. Add the primitives (buttons, pill, row, panel, micro-caps label, stat cell).
3. Rebuild the Overview to layout `3a` — ink band, calendar grid, deadline rail.
4. Sweep the remaining screens onto the primitives; anything not yet designed keeps its current structure with
   new tokens until the design lands.
