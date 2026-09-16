// Which overlay Escape belongs to.
//
// The drawer, the document reader and the search palette all listen on the
// window, and all three answer the same key. Registration order decides who
// hears it first, which is not the same question as who is on top: the drawer
// registers before the reader it contains, and the palette can open over either
// of them. `stopImmediatePropagation` cannot settle it either, for the same
// reason — the listener that would have to call it is not necessarily the one
// that runs first.
//
// So each overlay says what layer it sits at, the same way lib/title.js claims
// the tab, and only the topmost one acts. Ties go to whichever mounted last,
// which is the one drawn over the other.

import { useEffect, useState } from "react";

// Coarse on purpose: a thing over the page, a thing over that, and the palette,
// which is summoned from anywhere and is always the frontmost thing on screen.
export const LAYER = { overlay: 10, reader: 20, top: 30 };

const claims = new Map();
const listeners = new Set();
let nextId = 1;

function topmost() {
  let best = null;
  for (const [id, level] of claims) {
    if (!best || level > best.level || (level === best.level && id > best.id)) {
      best = { id, level };
    }
  }
  return best?.id ?? null;
}

const notify = () => listeners.forEach((fn) => fn());

/**
 * True while this overlay is the frontmost one mounted.
 *
 * @param {number} level One of LAYER's values.
 */
export function useTopmost(level) {
  const [id] = useState(() => nextId++);
  const [isTop, setIsTop] = useState(false);

  useEffect(() => {
    const update = () => setIsTop(topmost() === id);
    claims.set(id, level);
    listeners.add(update);
    // Everyone re-reads: the overlay that was on top a moment ago is not any
    // more, and it is the one that has to stand down.
    notify();
    return () => {
      claims.delete(id);
      listeners.delete(update);
      notify();
    };
  }, [id, level]);

  return isTop;
}
