// grades.py, line for line: weighted grade maths, pure, no I/O. The breakdown's
// category ids can be null (the uncategorised rows), so weights are held in Maps,
// which take null as a key the way a Python dict takes None.

const DEFAULT_SCALE = { A: 90, B: 80, C: 70, D: 60 };

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

export function buildBreakdown(categories, columns, grades, weights = {}, assign = {}) {
  const byId = new Map();
  for (const cat of categories) {
    if (!cat.id) continue;
    byId.set(cat.id, {
      category_id: cat.id, title: cat.title || "Uncategorised",
      weight: weights[cat.id] ?? null,
      earned: 0, graded_possible: 0, total_possible: 0, columns: [],
    });
  }
  // Columns with no category still have to land somewhere.
  const other = {
    category_id: null, title: "Uncategorised", weight: weights[""] ?? null,
    earned: 0, graded_possible: 0, total_possible: 0, columns: [],
  };

  for (const col of columns) {
    const possible = num(col.score?.possible);
    if (!possible || possible <= 0) continue;
    const placed = assign[col.id ?? ""] || col.gradebookCategoryId;
    const bucket = byId.get(placed ?? "") ?? other;
    const row = grades[col.id ?? ""] ?? {};
    let score = num(row.displayGrade?.score);
    if (score === null) score = num(row.score);
    const graded = score !== null && !row.exempt;

    bucket.total_possible += possible;
    if (graded) {
      bucket.earned += score;
      bucket.graded_possible += possible;
    }
    bucket.columns.push({
      column_id: col.id ?? null, name: col.name ?? null, possible,
      score: graded ? score : null, graded, due: col.grading?.due ?? null,
    });
  }

  const out = [...byId.values()].filter((b) => b.columns.length);
  if (other.columns.length) out.push(other);
  for (const b of out) {
    b.remaining_possible = b.total_possible - b.graded_possible;
    b.pct_graded = b.graded_possible ? (100 * b.earned) / b.graded_possible : null;
  }
  return out;
}

/** Each category's weight, falling back to points when none was entered. */
function effectiveWeights(breakdown) {
  const declared = breakdown.filter((b) => num(b.weight) !== null);
  if (declared.length) return new Map(declared.map((b) => [b.category_id, b.weight]));
  const total = breakdown.reduce((s, b) => s + b.total_possible, 0) || 1;
  return new Map(breakdown.map((b) => [b.category_id, b.total_possible / total]));
}

export function currentGrade(breakdown) {
  const weights = effectiveWeights(breakdown);
  const active = breakdown.filter((b) => b.graded_possible > 0 && weights.get(b.category_id));
  const totalW = active.reduce((s, b) => s + weights.get(b.category_id), 0);
  if (!active.length || totalW <= 0) return null;
  return active.reduce((s, b) => s + weights.get(b.category_id) * b.pct_graded, 0) / totalW;
}

export function projectedGrade(breakdown, rate) {
  const weights = effectiveWeights(breakdown);
  const active = breakdown.filter((b) => b.total_possible > 0 && weights.get(b.category_id));
  const totalW = active.reduce((s, b) => s + weights.get(b.category_id), 0);
  if (!active.length || totalW <= 0) return null;
  let total = 0;
  for (const b of active) {
    const final = (b.earned + b.remaining_possible * rate) / b.total_possible;
    total += weights.get(b.category_id) * final * 100;
  }
  return total / totalW;
}

/** What you must score on one assignment to finish at `target`. */
export function neededOn(breakdown, columnId, target, rate = 1) {
  const weights = effectiveWeights(breakdown);
  let home = null;
  let column = null;
  for (const b of breakdown) {
    const hit = b.columns.find((c) => c.column_id === columnId);
    if (hit) { home = b; column = hit; break; }
  }
  if (!home) return null;
  if (column.graded) {
    return { column_id: columnId, name: column.name, already_graded: true,
             score: column.score, possible: column.possible };
  }

  const active = breakdown.filter((b) => b.total_possible > 0 && weights.get(b.category_id));
  const totalW = active.reduce((s, b) => s + weights.get(b.category_id), 0);
  const wHome = weights.get(home.category_id) ?? 0;
  if (totalW <= 0 || wHome <= 0 || home.total_possible <= 0) return null;

  let others = 0;
  for (const b of active) {
    if (b.category_id === home.category_id) continue;
    const final = (b.earned + b.remaining_possible * rate) / b.total_possible;
    others += weights.get(b.category_id) * final * 100;
  }
  const restHere = Math.max(home.remaining_possible - column.possible, 0);
  const x = ((target * totalW - others) * home.total_possible) / (wHome * 100)
    - home.earned - restHere * rate;
  const pct = column.possible ? (100 * x) / column.possible : null;
  return {
    column_id: columnId, name: column.name, possible: column.possible,
    target, assumed_rate: rate,
    needed_points: round(x, 2),
    needed_pct: pct !== null ? round(pct, 1) : null,
    already_secured: x <= 0,
    achievable: pct !== null && pct <= 100,
  };
}

export function letterFor(pct, scale = null) {
  if (pct === null || pct === undefined) return null;
  const floors = Object.entries(scale || DEFAULT_SCALE).sort((a, b) => b[1] - a[1]);
  for (const [name, floor] of floors) if (pct >= floor) return name;
  return "F";
}

export function summarise(breakdown, scale = null, rate = 1) {
  const cur = currentGrade(breakdown);
  const proj = projectedGrade(breakdown, rate);
  const weights = effectiveWeights(breakdown);
  return {
    current_pct: cur !== null ? round(cur, 2) : null,
    current_letter: letterFor(cur, scale),
    projected_pct: proj !== null ? round(proj, 2) : null,
    projected_letter: letterFor(proj, scale),
    assumed_rate: rate,
    weighted_by: breakdown.some((b) => num(b.weight) !== null) ? "custom" : "points",
    categories: breakdown.map((b) => ({
      title: b.title,
      category_id: b.category_id,
      weight: b.weight,
      effective_weight: round(weights.get(b.category_id) ?? 0, 4),
      earned: round(b.earned, 2),
      graded_possible: round(b.graded_possible, 2),
      total_possible: round(b.total_possible, 2),
      pct: b.pct_graded !== null ? round(b.pct_graded, 1) : null,
      columns: b.columns,
    })),
  };
}
