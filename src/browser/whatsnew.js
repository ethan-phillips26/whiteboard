// Whether this browser has been told about the Claude tab.
//
// Beside the welcome flag, not inside the cache, for the same reason: logging out
// empties the store, and an announcement that came back every time someone signed
// out would be nagging. A browser that has never been welcomed is marked too —
// the welcome is its introduction, and it should not be followed by a second modal.

const KEY = "announced-claude";

/** A browser that refuses storage answers yes: once wrong beats a modal on every load. */
export function seen() {
  try {
    return localStorage.getItem(KEY) === "yes";
  } catch {
    return true;
  }
}

export function mark() {
  try {
    localStorage.setItem(KEY, "yes");
  } catch {
    // It was shown; it just will not be remembered.
  }
}
