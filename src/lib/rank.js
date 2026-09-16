/**
 * How well a thing matches what was typed.
 *
 * Spotlight-style search is judged on its first row, not its hundredth, so this
 * is a ranking function rather than a filter. Every term has to land somewhere
 * on a record for it to survive; what decides the order is *where* it landed —
 * the title of an assignment beats the same word buried in the third paragraph
 * of a document, and a word the title starts with beats one it merely contains.
 *
 * Fuzzy matching is allowed on names and never on bodies. A subsequence match
 * over an 8000-character body matches essentially everything ("abc" is in any
 * long enough text), which turns the list into noise; over a title it is the
 * thing that lets "l4s" find "Lecture 4 slides".
 */

// Everything that is not a letter or a digit divides one word from the next, in
// any script — Blackboard titles are as likely to be "CS2400_HW3-final" as prose.
const BREAK = /[^\p{L}\p{N}]/u;

export function terms(query) {
  return String(query ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The shortest window of `hay` containing `term`'s letters in order, or null. */
function subsequence(hay, term) {
  let at = 0;
  let start = -1;
  for (const ch of term) {
    at = hay.indexOf(ch, at);
    if (at < 0) return null;
    if (start < 0) start = at;
    at++;
  }
  return { at: start, span: at - start };
}

/**
 * One term against one piece of text: a score, or null for no match.
 *
 * The bands are deliberately far apart so that a weaker field can never add up
 * to a stronger one — three body mentions do not outrank a title that starts
 * with the word.
 */
export function matchTerm(text, term, { fuzzy = false } = {}) {
  const hay = String(text ?? "").toLowerCase();
  if (!hay || !term) return null;

  const at = hay.indexOf(term);
  if (at === 0) return { at, score: hay.length === term.length ? 1000 : 700 };
  if (at > 0) {
    // "Starts with" means the start of a word, to a reader looking at a title
    // of several words; anywhere else is a plain containment.
    const wordStart = BREAK.test(hay[at - 1]);
    return { at, score: wordStart ? 500 : 300 };
  }
  if (!fuzzy) return null;

  const run = subsequence(hay, term);
  if (!run) return null;
  // Letters that arrived close together are a likelier abbreviation than the
  // same letters scattered across the whole string.
  return { at: run.at, score: 60 + 100 * (term.length / run.span) };
}

/**
 * What a record is made of, and how much each part counts.
 *
 * A file's name is weighted close to a title because it usually *is* the title
 * as far as the reader is concerned — nobody remembers that the slides were
 * posted inside an item called "Week 4".
 */
const FIELDS = [
  { key: "title", weight: 3, fuzzy: true },
  { key: "files", weight: 1.6, fuzzy: true, many: true },
  { key: "subtitle", weight: 1.2, fuzzy: true },
  { key: "course", weight: 1, fuzzy: false },
  { key: "body", weight: 0.5, fuzzy: false },
  { key: "text", weight: 0.35, fuzzy: false },
];

/** The best any one field does on this term, and which field that was. */
function bestField(record, term) {
  let best = null;
  for (const field of FIELDS) {
    const value = record[field.key];
    if (!value) continue;
    const candidates = field.many ? value : [value];
    for (const candidate of candidates) {
      const hit = matchTerm(candidate, term, { fuzzy: field.fuzzy });
      if (!hit) continue;
      const score = hit.score * field.weight;
      if (!best || score > best.score) {
        best = { score, field: field.key, at: hit.at, text: candidate };
      }
    }
  }
  return best;
}

/**
 * Score one record against every term. Null unless all of them matched
 * something, so "quiz 3" does not return every quiz in the term.
 */
export function scoreRecord(record, queryTerms) {
  let total = 0;
  const where = [];
  for (const term of queryTerms) {
    const hit = bestField(record, term);
    if (!hit) return null;
    total += hit.score;
    where.push(hit);
  }
  // A short title matching is a better answer than a long one matching the same
  // way; this only ever breaks ties, never a band.
  const length = String(record.title ?? "").length;
  total += (record.boost ?? 0) - Math.min(length, 120) / 240;
  return { score: total, where };
}

/** The text a hit should be shown with: the part of the body it landed in. */
export function snippet(record, hits, width = 120) {
  const inBody = hits?.find((h) => h.field === "body" || h.field === "text");
  if (!inBody) return "";
  const text = String(inBody.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= width) return text;
  const start = Math.max(0, inBody.at - Math.floor(width / 3));
  const cut = text.slice(start, start + width).trim();
  return (start > 0 ? "…" : "") + cut + (start + width < text.length ? "…" : "");
}

/**
 * Every record that matches, best first.
 *
 * Ties are broken by the order the corpus was built in, which is itself
 * meaningful — courses, then deadlines, then material — so an unstable sort
 * cannot make the list jump about between keystrokes.
 */
export function rank(records, query, { limit = 40 } = {}) {
  const queryTerms = terms(query);
  if (!queryTerms.length) return [];
  const out = [];
  records.forEach((record, index) => {
    const scored = scoreRecord(record, queryTerms);
    if (scored) {
      out.push({
        record,
        score: scored.score,
        index,
        snippet: snippet(record, scored.where),
      });
    }
  });
  out.sort((a, b) => b.score - a.score || a.index - b.index);
  return out.slice(0, limit);
}
