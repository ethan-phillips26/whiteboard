import { courseSlot } from "../lib/format.js";
import { href } from "../lib/route.js";

// Unread announcements are something to go and read, so theirs is the one count
// set solid; how many gradebooks total up is only a fact.
const SECTIONS = [
  { name: "overview", label: "Overview", to: href.overview },
  { name: "grades", label: "Grades", to: href.grades },
  { name: "announcements", label: "Announcements", to: href.announcements, loud: true },
];

// Drawn inline, stroked in currentColor, so they take the tab's colour in both
// themes and there is no icon font or asset to ship for four shapes.
const ICONS = {
  overview: <><rect x="3.5" y="5" width="17" height="15.5" rx="1.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  grades: <path d="M5.5 20v-8M12 20V5M18.5 20v-11" />,
  announcements: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.8 1.8H4.7zM10 21h4" />,
  settings: <path d="M4 7h9M17 7h3M15 4.8v4.4M4 17h3M11 17h9M9 14.8v4.4" />,
};

function Icon({ name }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

/**
 * The sections, as a bar along the bottom of a phone.
 *
 * On a phone the sidebar lies down into a header that scrolls away, and the
 * sections are what a thumb reaches for from anywhere — so they leave it for a bar
 * of their own. Hidden wherever there is a sidebar to hold them.
 */
export function TabBar({ route, counts }) {
  const tabs = [...SECTIONS, { name: "settings", label: "Settings", to: href.settings }];
  return (
    <nav className="tabnav" aria-label="Sections">
      {tabs.map((s) => (
        <a
          key={s.name}
          href={s.to}
          className={route.name === s.name ? "tabnav-item on" : "tabnav-item"}
          aria-current={route.name === s.name ? "page" : undefined}
        >
          <span className="tabnav-icon">
            <Icon name={s.name} />
            {s.loud && counts[s.name] ? <span className="tabnav-count">{counts[s.name]}</span> : null}
          </span>
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/** "Ethan Phillips" if Blackboard gave us both halves, else whatever it gave. */
function fullName(me) {
  const name = me?.name ?? {};
  const both = [name.given, name.family].filter(Boolean).join(" ");
  return both || name.preferredDisplayName || me?.username || "";
}

export default function Sidebar({ me, courses, counts, route, order,
                                  onLogout, loggingOut, onSearch, demo = false }) {
  // Every course the sync kept. Courses whose gradebook the instructor hides
  // from students are dropped at the source, so there is nothing to filter here.
  const listed = courses;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Whiteboard</span>
        {demo && <span className="brand-demo">Demo</span>}
      </div>

      {/* A phone has no keyboard shortcut to find the palette with, and no
          room for the field-shaped button the dashboard carries. */}
      <button className="side-search" onClick={onSearch} aria-label="Search">
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"
             stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" />
        </svg>
      </button>

      {/* On a phone the sidebar lies down into one bar and this is the part
          that scrolls, so the mark stays put while the links slide under it.
          `display: contents` keeps it out of the way of the column layout. */}
      <div className="nav-strip">
      <nav>
        {SECTIONS.map((s) => (
          <a
            key={s.name}
            href={s.to}
            className={route.name === s.name ? "nav on" : "nav"}
            aria-current={route.name === s.name ? "page" : undefined}
          >
            {s.label}
            {counts[s.name] ? (
              <span className={s.loud ? "count-pill" : "nav-count"}>{counts[s.name]}</span>
            ) : null}
          </a>
        ))}
      </nav>

      {listed.length > 0 && (
        <nav className="nav-group">
          <div className="nav-title">Courses</div>
          {listed.map((c) => (
            <a
              key={c.course_id}
              href={href.course(c.course_id)}
              className={
                (route.name === "course" && route.id === c.course_id
                  ? "nav on" : "nav") + " nav-course s" + courseSlot(c.label, order)
              }
              title={c.title && c.title !== c.label ? c.title : c.label}
            >
              <i className="dot" />
              <span className="nav-course-name">{c.label}</span>
            </a>
          ))}
        </nav>
      )}

      <nav className="nav-foot">
        <a
          href={href.settings}
          className={route.name === "settings" ? "nav on" : "nav"}
          aria-current={route.name === "settings" ? "page" : undefined}
        >
          Settings
        </a>
      </nav>
      </div>

      {/* Who is signed in, and the way out. The course count and the sync clock
          that used to live here were facts about the data rather than anything
          to act on, and both are said on the screen that uses them. */}
      <div className="side-foot">
        <div className="side-who" title={fullName(me)}>{fullName(me)}</div>
        <button className="side-out" onClick={onLogout} disabled={loggingOut}>
          {loggingOut
            ? <><span className="spin" /> {demo ? "Leaving" : "Logging out"}</>
            : demo ? "Exit demo" : "Log out"}
        </button>
      </div>
    </aside>
  );
}
