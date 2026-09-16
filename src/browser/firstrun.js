// Whether this browser has ever been welcomed.
//
// Kept in localStorage rather than the cache, so that clearing stored data or
// logging out — both of which empty the store — do not turn the tour back on for
// someone who has already read it. It belongs to the browser, like the theme.
//
// The demo keeps its own flag: trying the demo should not consume the welcome
// for the real account, and vice versa.

import { DEMO } from "./mode.js";

const KEY = DEMO ? "welcomed-demo" : "welcomed";

/**
 * Has the welcome been shown here before?
 *
 * A browser that refuses storage answers yes. It is the wrong answer exactly
 * once, and it is the harmless direction: the alternative is a modal on every
 * single load with no way to make it stop.
 */
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

/** Forget it, so the tour can be read again. Settings offers this, because a
 *  once-only screen with no way back is a screen nobody can check. */
export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was remembered in the first place.
  }
}
