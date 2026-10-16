import { inline, parse } from "../lib/markdown.js";

/** Inline runs as elements. Everything is a React node, never markup, so what
 * Claude wrote cannot become HTML. */
export function Runs({ runs }) {
  return runs.map((r, i) => {
    switch (r.type) {
      case "strong": return <strong key={i}><Runs runs={r.children} /></strong>;
      case "em": return <em key={i}><Runs runs={r.children} /></em>;
      case "code": return <code key={i}>{r.text}</code>;
      case "link":
        return <a key={i} href={r.href} target="_blank" rel="noopener noreferrer"><Runs runs={r.children} /></a>;
      default: return r.text;
    }
  });
}

/** Inline-only Markdown, for a line that is a sentence: a question, a choice. */
export function Line({ text }) {
  return <Runs runs={inline(String(text ?? ""))} />;
}

function Blocks({ blocks }) {
  return blocks.map((b, i) => {
    switch (b.type) {
      case "heading": {
        const H = `h${Math.min(4, b.level + 1)}`;
        return <H key={i}><Runs runs={b.children} /></H>;
      }
      case "paragraph": return <p key={i}><Runs runs={b.children} /></p>;
      case "rule": return <hr key={i} />;
      case "quote": return <blockquote key={i}><Blocks blocks={b.children} /></blockquote>;
      case "code": return <pre key={i}><code>{b.text}</code></pre>;
      case "list": {
        const List = b.ordered ? "ol" : "ul";
        return (
          <List key={i}>
            {b.items.map((it, j) => (
              <li key={j} style={it.depth ? { marginLeft: `${it.depth * 1.2}em` } : undefined}>
                <Runs runs={it.children} />
              </li>
            ))}
          </List>
        );
      }
      case "table":
        return (
          <div className="md-table" key={i}>
            <table>
              <thead><tr>{b.head.map((c, j) => <th key={j}><Runs runs={c} /></th>)}</tr></thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>{r.map((c, k) => <td key={k}><Runs runs={c} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default: return null;
    }
  });
}

export default function Markdown({ text }) {
  return <div className="md"><Blocks blocks={parse(text)} /></div>;
}
