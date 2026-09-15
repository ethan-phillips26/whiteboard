# Redesign brief: Whiteboard

I want a full visual redesign of **Whiteboard**, a web app I built. Please design every screen
listed below at desktop and phone width, in light and dark themes, plus a small design
system (tokens and components) that the screens are built from. The structure, content and
behaviour described here are fixed. The visual language is yours to change: layout within a
screen, typography, colour, density, iconography, motion. The current look is described at
the end so you know what you are replacing, not so you can copy it.

---

## 1. What it is

Whiteboard is a **read-only dashboard over Blackboard Learn**, the learning-management
system many universities use. Blackboard scatters a student's coursework across dozens of
slow pages: deadlines in one place, grades in another, handouts buried three folders deep,
announcements somewhere else again. Whiteboard pulls all of it into one fast, calm place
that answers a student's real questions:

- **What is due, and when?** (the main question, on the home screen)
- **How am I doing in each course, and what do I need on the next thing?**
- **Where is the handout for this assignment?** (and let me read it without downloading)
- **Did any instructor post something I need to know?**

It runs entirely in the browser. There is no server and no account. A small browser
extension, the **Whiteboard Connector**, does the reading from Blackboard using the student's
existing Blackboard login and hands the data to the page. Everything is cached locally.

**It never changes anything on Blackboard.** It can't submit, post or reply. Any "edit" in
the app is a local correction layered on top, such as fixing a wrong due date the instructor
entered or typing in the syllabus's grade weights. The design must never imply that the app
submits work or messages anyone. Where the student has to act in Blackboard itself, the app
links out ("Open in Blackboard ↗").

**Audience:** university students, mostly on laptops, often on phones. They check it
several times a day, quickly. It's a personal tool, not an institutional product, so it
shouldn't look like Blackboard or like enterprise software.

**Tone:** calm, clear, trustworthy, a little warm. Plain language ("Nothing is due in the
next 7 days", "3d overdue", "if you ace the rest"). No gamification, no streaks, no
exclamation-mark urgency. Overdue should be noticeable without being alarming.

**Name and mark:** "Whiteboard" (a play on Blackboard). The current mark is a small rounded
square with a blue→violet gradient. A new mark is welcome.

---

## 2. Global structure

### App shell
- **Sidebar (desktop, ~230px)**, top to bottom:
  - Brand: mark and "Whiteboard", plus a small **"Demo"** flag when running in demo mode.
  - Primary nav: **Overview**, **Grades**, **Announcements**. Announcements carries an
    unread-count pill, and Grades a count of courses with a visible gradebook.
  - **Courses** group: one link per enrolled course (typically 4 to 7), each with its
    **course colour dot** and short label (e.g. "CSCI 366"). Long names truncate with an
    ellipsis, and the full title shows on hover.
  - **Settings** link, pinned toward the bottom.
  - Footer: the student's full name and **Log out** (or **Exit demo** in demo mode).
- **Phone and tablet (<900px):** the sidebar becomes a **sticky top bar**. The brand mark
  stays fixed, all nav links and courses scroll sideways in one strip (with a fade at the
  edge to show there's more), and Log out stays pinned. Please design this properly; it's
  the phone experience of the whole app.
- **Main area:** screen content, max readable width, generous padding.

### Routing (every screen has its own URL, so back button and bookmarks work)
- `#/` Overview (dashboard)
- `#/grades` All grades
- `#/announcements` All announcements
- `#/course/:id` Course page, Overview tab (also `/materials`, `/grades`, `/announcements`)
- `#/settings` Settings, and `#/settings/:courseId` for one course's settings

### Overlays (sit above any screen)
- **Assignment drawer:** slides in from the right.
- **Document viewer:** a near-fullscreen reader that stacks above the drawer.
- **Calendar day modal:** opens from a calendar cell.
- **New-announcements modal:** appears once on load when something new was posted.

Only one overlay handles Escape at a time: the topmost one.

---

## 3. Course colour: the one visual system that must survive

Every course gets **one identity colour**, used everywhere it appears: sidebar dot,
calendar chips, deadline rows, grade cards, announcement rows. There are **8 categorical
slots**, assigned by sorted course name and never cycled, so a course is the same colour on
every screen. Colour is **always paired with the course's name or code**, never the only
signal (accessibility). Provide the 8 hues for both light and dark themes (dark should be
the same hues re-stepped for a dark surface, not an inverted palette), and check them
against each other and against red (overdue) and green (good).

---

## 4. Screens

Sample data for all mockups (this is the app's built-in demo student). **Jordan Rivera**,
a CS student at NDSU, is enrolled in five courses:

| Label | Title | Gradebook categories |
|---|---|---|
| CSCI 313 | Software Development with Frameworks | Assignments, Team Project, Participation |
| CSCI 336 | Theoretical Computer Science | Problem Sets, Exams |
| CSCI 366 | Database Systems | Homework, Quizzes, Exams, Term Project |
| CSCI 374 | Computer Organization and Architecture | Labs, Homework, Exams |
| CSCI 467 | Algorithm Analysis | Homework, Quizzes, Exams |

Realistic items: "HW 3: SQL Queries" (50 pt, due in 3 days), "Homework 2: Divide and
Conquer" (50 pt, due in 2 days), "Lab 3: Procedures and the Stack" (20 pt, in 4 days),
"Quiz 2" (20 pt, in 6 days), "A3: REST API with Express" (100 pt, in 8 days), "Midterm
Exam" (100 pt, in 12 days), "Final Project" (150 pt, in 45 days). Grades are mostly in the
85–95% range. Announcements: "Midterm review session" (1d ago), "Homework 2 hint" (1d ago),
"Lab moved this week" (2d ago), "Office hours moved to Wednesday" (3d ago).

### 4.1 Connect / sign-in (shown when not connected)
A single centred card. One of four states is shown, and each needs a design:

1. **Install the extension** (no extension detected). A short explanation ("This page can't
   read Blackboard by itself. The Whiteboard Connector extension does the reading with the
   Blackboard session already in this browser."), then:
   - Primary: **Download the extension** (a zip).
   - Secondary: **See a demo**, with the note "Made-up data for a sample NDSU computer
     science student. No account needed." This is how most first-time visitors will try the
     app, so it deserves real prominence.
   - Two sets of install steps: **Chrome, Edge or Brave** (unzip; open
     `chrome://extensions`; turn on Developer mode; Load unpacked) and **Firefox** (open
     `about:debugging#/runtime/this-firefox`; Load Temporary Add-on; note that Firefox
     removes it on restart). The visitor's own browser is shown first.
   - **"I've installed it — reload"** button.
2. **Connect to Blackboard:** one field, "Blackboard address"
   (placeholder `blackboard.university.edu`), and a **Connect** button. There's also an
   error variant: "Blackboard answered, but not the way a signed-in session does. Check the
   address."
3. **Waiting:** a spinner with copy, in two variants. One is "Allow access" ("The extension
   opened a tab asking to read **blackboard.ndsu.edu**. Allow it there, and this page carries
   on by itself."). The other is "Waiting for your sign-in" ("Blackboard is open in a new
   tab. Sign in there — including anything on your phone — and this page picks up as soon as
   you're in.").
4. **Sign in to Blackboard** (connected but signed out): "You're not signed in to
   **blackboard.ndsu.edu** in this browser." Primary: **Open Blackboard's sign-in**. Link:
   "Use a different Blackboard".

Also design the boot states: a full-screen centred spinner with "Checking Blackboard
session…" or "Loading coursework…".

This is the app's front door and first impression. It can be more expressive than the
rest, perhaps with a short line on what Whiteboard is for someone arriving cold.

### 4.2 Overview (dashboard, the home screen)
**Constraint:** on a large enough window (≥1081×780) the whole dashboard fits in **one
screen with no page scroll**. The header, stats, calendar and deadline list are meant to be
read together. The calendar grid stretches to fill the remaining height, and the deadline
list scrolls inside its own panel (with a fade at the bottom). Smaller than that, it stacks
and the page scrolls.

- **Header:** "Welcome back, Jordan!", with the date and "synced 10:42 AM" beneath it.
  Actions: **Sync now** (primary, shows a spinner and "Syncing" while running) and **Export
  .ics** (downloads a calendar file of every deadline).
- **Error banner** (when a sync fails).
- **Stats row:**
  - **Hero, "Next deadline":** a big live countdown ("**2** days left", "**5** hours left",
    "**40** minutes left", or a late variant "**3** hours ago"), with the item's title, its
    course (with colour), the exact date and time, and a relative phrase. Its empty state is
    "0 outstanding · Nothing is due in the sync window."
  - Three small tiles: **Due this week** (count, "next 7 days"), **Overdue** (count; red
    tone when >0, green "nothing missed" when 0), and **Courses** (count, "this term").
  - Responsive: 4 across on wide screens. Narrower, the hero takes a full row and lies
    horizontal with 3 tiles below. Then 2 columns, then 1.
- **Calendar panel (left, wider):** a month grid, Sunday first, 6 rows.
  - Header: "Calendar · 9 due in September", with **‹ Today ›** controls.
  - Month title, e.g. "**September** 2026".
  - Each day cell shows its date number and up to **3 course-coloured chips** (dot plus
    title, truncated), then "+2 more". Today is marked, neighbouring-month days are dimmed,
    and past items are dimmed.
  - **A day that has items is one big button.** The chips inside it are inert previews,
    never separate buttons. Clicking the cell opens the **Day modal**.
  - **Legend** below the grid: one toggle per course with work in view. Clicking one filters
    the grid to that course; it has a pressed state and a "Show all courses" link.
  - On phones, chips can't fit, so a cell shows only "**2 due**" and opens the same modal.
- **Deadlines panel (right, narrower):** "Deadlines · 14 outstanding". Every outstanding
  item is listed, soonest first, and the list is never truncated. Each row is a full-width
  button with the course colour dot, **title**, a "new" badge if first seen in the last
  24h, the date and time and points ("Thu, Sep 17, 11:59 PM · 50 pt"), a course chip, and
  on the right a **relative due pill** in three tones: overdue (red, "2d overdue"), soon
  (≤3 days, amber, "tomorrow" or "in 5h"), and later (neutral, "in 12 days" or "next
  week"). Clicking a row opens the **Assignment drawer**. Its empty state is "Nothing
  outstanding in the next 60 days."

### 4.3 Day modal (from a calendar cell)
Centred modal titled with the long date ("Thursday, September 17") and a Close button. It
lists that day's items as full-width buttons: dot, **title**, course chip, then "Due 11:59
PM · in 3 days · 50 pt · submitted", and the full course name if it differs. Clicking an
item closes the modal and opens the Assignment drawer.

### 4.4 Assignment drawer (from any deadline, calendar item or course material)
A right-side panel over a dimmed scrim, full width on phones.
- **Header:** title, course chip, "Thu, Sep 17, 11:59 PM · in 3 days · 50 pt" (or "no due
  date"), an **Open in Blackboard ↗** button, and **Close**.
- **Body:**
  - A loading state ("Reading the assignment…"), then the **instructions** as rich text
    (paragraphs, lists, bold, links). Its empty state is "There is nothing written on this
    item."
  - **Files:** "Files · 2 attached". Each file row has a file-type badge (PDF, DOCX, SQL…),
    the filename, its size, **View** (primary, for types readable in-app) and
    **Download**, and per-button busy states ("Opening", "Fetching"). There's an error per
    file ("Couldn't fetch hw3.pdf: …").
  - A special case: a gradebook column with no content behind it gets an explanatory note
    instead of instructions and files.
- The drawer is the most-used overlay, so it must read well at 400–560px wide.

### 4.5 Document viewer (from View in the drawer or a file in Materials)
A near-fullscreen reader on its own scrim, above the drawer. Header: file-type badge,
filename, size (and "· read in the browser" for Word and PowerPoint), **Download**, and
**Close**. The body adapts to the file type:
- **PDF:** embedded browser viewer.
- **Image, video, audio:** shown natively.
- **Text and code** (.sql, .py, .asm, .md, .json): monospaced preformatted text.
- **Word (.docx):** rendered pages on a neutral backdrop.
- **PowerPoint (.pptx):** a vertical list of slide cards, each with "Slide 3", the title,
  images, bullet lines, and a collapsible "Speaker notes".
- **Unsupported types:** an explanation plus a **Download** button.
- Also loading ("Reading DOCX…") and error ("Download it instead") states.

### 4.6 Grades (all courses)
Header: "Grades", with "5 courses" beneath. A **grid of course cards**, all the same size
so a row reads as a row. Each card has:
- Course colour dot, label ("CSCI 366"), and full title.
- A big current grade, "**91.4%** A" (or "Nothing graded yet").
- "7 of 9 items graded".
- A footer flag: **weighted** (the student entered syllabus percentages) or **weighted by
  points** (the default), plus an arrow.

The whole card links to that course's Grades tab. Courses whose gradebook the instructor
hides are left off entirely. The empty state is "None of your courses have a gradebook
visible to students."

### 4.7 Announcements (all courses)
Header: "Announcements", with "6 recent · 2 new since you last looked" beneath. A single
reading-width panel lists announcements newest first. Each row has the course colour dot,
**title**, a "new" badge, a course chip, and a relative time ("1d ago", with the full date
on hover). The body is rich text clamped to ~220 characters with **Read more / Show less**.
Opening this screen clears the sidebar's unread badge. The empty state is "Nothing posted in
your courses."

### 4.8 New-announcements modal (once, on load)
When posts arrived that were never shown, a modal appears once: "2 new announcements" (or
"New announcement"), with a primary **Got it** button. The body is the same announcement
list (without "new" badges, since they are all new). The footer has an "Open announcements"
link. It waits for the drawer to close rather than stacking on top of it.

### 4.9 Course page (`#/course/:id`)
- A back link, "← Dashboard".
- **Course header:** the label ("CSCI 366") as H1, the full title beneath, and a small
  "Open in Blackboard ↗" link. On the right, **Grade so far**: "**91.4%** A" and, beneath,
  "96.2% if you ace the rest" (projected). This block is hidden if the gradebook is hidden.
- **Tab bar** (a segmented control): **Overview** (count of outstanding items), **Materials**,
  **Grades**, and **Announcements** (count). On the right: "Next: **HW 3: SQL Queries** · in 3
  days".

**Overview tab** (two columns, stacking on narrow screens):
- **Up next:** "4 outstanding". Up to 6 deadline rows (same pattern as the dashboard, but
  without the course colour, since it's all one course), then "See all 9 in this course's
  material →".
- **At a glance:** a definition list. "Graded so far: 5 of 9 items". "Weighting: your
  percentages" or "by points — no weighting entered".
- **Announcements** (full width below): the 3 most recent, clamped, with a "See all" button.

**Materials tab:** the course's content tree, as the instructor laid it out.
- Header panel: "Materials · 14 items · 4 folders · 11 files", **Expand all / Collapse
  all**, **Refresh**, a **search field** ("Search titles, text and file names…"), a match
  count ("3 items match 'sql'"), and "Read 5m ago".
- **Folders** (e.g. "Week 1: The Relational Model", "Week 3: SQL", "Assignments") are
  collapsible rows with a caret, **title**, and "3 items". They nest up to 3 levels, with
  visible indentation. A search opens every folder containing a hit and highlights matches.
- **Items** have a **kind label** column (Assignment, Document, File, Link, Test, Forum,
  Syllabus, Module…), a **title** (links out with ↗ for external links), and an inline
  status: a score ("46 / 50") if graded, otherwise a relative due pill ("in 3 days", red if
  overdue). A meta line reads "Due Thu, Sep 17, 11:59 PM · 50 pt · 2 files" (or "Updated 3d
  ago"). The description is clamped with Read more. **File chips** are compact buttons with a
  type badge, filename, size, a ↓ if download-only, a spinner while fetching, and a "have it"
  state once fetched. On the right is a stacked action pair: a small "Open in Blackboard ↗"
  above a larger **Open** (which opens the Assignment drawer).
- States: loading ("Reading the course…"), error with Try again, content hidden, empty,
  no search matches, and "tree truncated" (the course is deeper than shown).

**Grades tab** (two columns, then a table):
- **Breakdown:** "weighted by your percentages" or "weighted by points", with a button
  **Set weighting** or **Edit weighting** (goes to course settings). One row per category
  shows its name, weight ("30%", or "25%*" when derived from points), a **progress bar** of
  the category score, and the score ("92.0%" or "—"). There's a footnote explaining the
  asterisk and linking to settings, and a note listing categories left without a percentage.
- **What do I need?** (a calculator): a select for the ungraded item ("Midterm Exam (100
  pt)"), **Target %** (90), **Rest at %** (100, meaning what you assume you'll score on
  everything else), and a **Calculate** button. The result box has three tones:
  - **Needed:** "**78 / 100** (78%) on **Midterm Exam** to finish at 90%, assuming
    everything else outstanding comes in at 100%."
  - **Good:** "**Already secured.** You reach 90% even with 0 on Midterm Exam…"
  - **Bad:** the needed figure, plus "**Not reachable on this assignment alone** — it needs
    more than full marks. Lower the target or raise your assumption for the rest."
  - Its empty state is "Nothing ungraded left to calculate against."
- **Items:** a table of every gradebook row, with name, a category chip (hidden on phones),
  and score ("46 / 50" or "— / 50").
- If the gradebook is hidden, show a single panel with the reason.

**Announcements tab:** "Announcements · 2 posted", the same list as 4.7 but without the
course colour or chip.

Also design the "Course not found" state: "That course is not in the current term", with
Back to dashboard.

### 4.10 Settings (`#/settings`)
Header: "Settings", with "Appearance, and corrections to what Blackboard reports." beneath,
and a **Back to dashboard** button.
- **Appearance:** a segmented control with **Light / Dark / Match system**, and a note
  ("following this device — dark" or "set by you").
- **Courses:** "5 enrolled — open one to correct its weighting or its deadlines". A grid of
  course cards, each with the label, title, "weighting entered" or "weighted by points", "9
  deadlines · 1 hidden", flags ("weights edited", "2 edited"), and an arrow.
- **Stored data:** a **Clear stored data** button that arms first. It turns into **Delete it
  all** (danger) with Cancel and "This cannot be undone." Afterwards it confirms: "Cleared 42
  cached entries and 6 files — 1.2 MB freed."

### 4.11 Course settings (`#/settings/:courseId`)
Header: the course label and title, with a **Back to settings** button.
- **Grade weighting:** one row per category, each with the category name, a small numeric
  input, and "%". There's a running total, "100% of 100", shown in amber when it isn't 100.
  **Save** is disabled until something changes. **Weight by points again** appears when
  weights have been edited. An "edited" flag shows when relevant. The empty state is "nothing
  in the gradebook to weight yet" or "gradebook hidden by the instructor".
- **Deadlines:** "9 outstanding · 1 hidden". A filter field appears when there are more than
  6 items. There's an expandable row per item: collapsed, it shows **title**, "edited" and
  "hidden" flags, "Thu, Sep 17, 11:59 PM · 50 pt", and Edit or Close. Expanded, it has
  fields for **Title**, **Due** (date-time), and **Points**, plus **Save**, **Hide from
  dashboard**, and **Reset to Blackboard** (if edited). A **Hidden** sub-list at the bottom
  gives each hidden item a **Show again** button.
- These corrections are local, a layer over Blackboard's data, and survive syncs. The
  design should make clear they only affect this app.

---

## 5. Shared components to define

Buttons (default, primary, danger, link-style; with a spinner and a disabled state),
segmented control, text, number, date-time, search and select fields, panel (card) with a
panel header (title, muted count note, spacer, actions), stat tile and hero, course colour
dot, course chip, calendar chip, "new" badge, count pill, flags (neutral, ok, warn),
relative-due pill (overdue, soon, later), deadline row, announcement row, file row, file
chip, file-type badge, category bar, course card, folder row, content item row, scrim,
modal, drawer, viewer, empty state, inline error, error banner, spinner, focus ring,
"Open in Blackboard ↗" link, and toast-free feedback (all status is inline; there are no
toasts).

---

## 6. Constraints and details

- **Themes:** light and dark, both first-class, plus "match system". Both must meet WCAG AA
  contrast for text and controls.
- **Responsive:** design at **1440×900** (the dashboard must fit with no scroll), **1024**
  (panels stack), and **390** (phone, sidebar as top bar). Nothing may scroll horizontally
  at any width. Only a wide table or code block may scroll inside its own container.
- **Row-shaped buttons:** many rows are full-width buttons (deadline rows, day-modal items,
  settings rows). They must look like rows, wrap their text, and have clear hover and focus
  states.
- **No nested interactives:** a calendar cell is the button, and its chips are inert.
- **Truncation:** course names, filenames and assignment titles can be long and come from
  registrars and instructors. Design for ellipsis or wrapping.
- **Numbers:** use tabular figures for counts, scores and times.
- **Motion:** subtle only, such as the drawer slide and modal fade. Respect reduced motion.
- **Fonts:** currently the system UI stack. A web font is fine if it loads from Google
  Fonts, with a system fallback.
- **Performance and implementation:** it will be rebuilt as React with one hand-written CSS
  file (tokens → primitives → screens), no UI framework and no Tailwind. Favour designs that
  are cleanly expressible as CSS custom properties and a small set of reusable classes. The
  icon set is minimal today (text arrows ‹ › → ↗ ↓ and a caret). A small, consistent icon set
  is welcome but optional.

## 7. The current look (what you're replacing)

A clean, neutral, Linear- or Notion-ish look: a cool grey-blue background (#f4f6f9), white
cards with 13px radii and faint shadows, a single blue accent (#2a78d6) with a pale blue
tint for the active nav, 14.5px system font, uppercase micro-labels, and a lot of muted grey
secondary text. Dark mode uses a near-black background (#0e1014) with #171a21 panels. It's
tidy, but generic: every panel looks the same, the hierarchy is flat, and there's no
personality. I'd like something with more character and clearer hierarchy (the countdown and
the deadline list should clearly be the heart of the app) while staying calm and fast to
scan.

## 8. Deliverables

1. A **design direction**: a short rationale, the type scale, colour tokens (light and
   dark, including the 8 course hues), spacing and radius scales, and elevation.
2. A **component sheet** covering section 5.
3. **Screens:** 4.1 (all four states), 4.2 (dashboard), 4.3, 4.4, 4.5 (PDF, and PPTX or
   text), 4.6, 4.7, 4.8, 4.9 (all four tabs), 4.10, and 4.11 (with one deadline row
   expanded). Show each at desktop; show at least the dashboard, a course page, the drawer
   and the connect screen at phone width; and show the dashboard and a course page in dark
   mode.
4. Key **empty, loading and error states** for the dashboard, Materials, and the drawer.
