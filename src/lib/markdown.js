// A small Markdown reader for what Claude writes: headings, paragraphs, lists, quotes,
// code, rules and tables, with bold, italic, code and links inside them. It makes a
// tree and never HTML, so nothing Claude (or a course page it read) wrote can inject
// markup; the component draws the tree as elements.

const SAFE_LINK = /^(https?:|mailto:)/i;

/** Inline markup to a flat list of runs. */
export function inline(src) {
  const out = [];
  const push = (run) => {
    const last = out[out.length - 1];
    if (run.type === "text" && last?.type === "text") last.text += run.text;
    else out.push(run);
  };
  let rest = src;
  while (rest) {
    let m;
    if ((m = rest.match(/^`([^`]+)`/))) push({ type: "code", text: m[1] });
    else if ((m = rest.match(/^\*\*([^*]+?)\*\*|^__([^_]+?)__/))) push({ type: "strong", children: inline(m[1] ?? m[2]) });
    else if ((m = rest.match(/^\*([^*\s][^*]*?)\*|^_([^_\s][^_]*?)_(?![A-Za-z0-9])/))) push({ type: "em", children: inline(m[1] ?? m[2]) });
    else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      if (SAFE_LINK.test(m[2])) push({ type: "link", href: m[2], children: inline(m[1]) });
      else push({ type: "text", text: m[1] });
    } else {
      // Up to the next character that could open markup, at least one.
      const next = rest.slice(1).search(/[`*_[]/);
      const n = next < 0 ? rest.length : next + 1;
      push({ type: "text", text: rest.slice(0, n) });
      rest = rest.slice(n);
      continue;
    }
    rest = rest.slice(m[0].length);
  }
  return out;
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRule = (l) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isTableRule = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const bullet = (l) => l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);

/** Blocks, in order. */
export function parse(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { i++; continue; }
    if ((m = line.match(/^(```|~~~)\s*([\w+-]*)/))) {
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith(m[1]); i++) body.push(lines[i]);
      i++;
      blocks.push({ type: "code", lang: m[2], text: body.join("\n") });
    } else if ((m = line.match(/^(#{1,4})\s+(.*?)\s*#*$/))) {
      blocks.push({ type: "heading", level: m[1].length, children: inline(m[2]) });
      i++;
    } else if (isRule(line)) {
      blocks.push({ type: "rule" });
      i++;
    } else if (line.trimStart().startsWith(">")) {
      const body = [];
      for (; i < lines.length && lines[i].trimStart().startsWith(">"); i++) body.push(lines[i].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", children: parse(body.join("\n")) });
    } else if (line.includes("|") && isTableRule(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(cells(lines[i]));
      blocks.push({
        type: "table",
        head: head.map(inline),
        rows: rows.map((r) => head.map((_, c) => inline(r[c] ?? ""))),
      });
    } else if ((m = bullet(line))) {
      const ordered = /\d/.test(m[2]);
      const items = [];
      for (; i < lines.length; i++) {
        const b = bullet(lines[i]);
        if (b && /\d/.test(b[2]) === ordered) {
          items.push({ depth: Math.min(2, Math.floor(b[1].length / 2)), text: b[3] });
        } else if (b || !lines[i].trim() || !/^\s{2,}\S/.test(lines[i])) break;
        else items[items.length - 1].text += " " + lines[i].trim();
      }
      blocks.push({ type: "list", ordered, items: items.map((it) => ({ depth: it.depth, children: inline(it.text) })) });
    } else {
      const body = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|~~~|>)/.test(lines[i])
             && !bullet(lines[i]) && !isRule(lines[i]); i++) body.push(lines[i].trim());
      blocks.push({ type: "paragraph", children: inline(body.join(" ")) });
    }
  }
  return blocks;
}

/** The text with the markup taken off, for a title or a plain-text copy. */
export function plain(src) {
  const text = (runs) => runs.map((r) => r.text ?? text(r.children ?? [])).join("");
  const walk = (blocks) => blocks.map((b) => {
    if (b.type === "code") return b.text;
    if (b.type === "list") return b.items.map((it) => text(it.children)).join("\n");
    if (b.type === "table") return [b.head, ...b.rows].map((r) => r.map(text).join("\t")).join("\n");
    if (b.type === "quote") return walk(b.children);
    return b.children ? text(b.children) : "";
  }).join("\n\n");
  return walk(parse(src));
}
