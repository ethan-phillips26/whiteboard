// A Word file from Markdown, written by hand: a .docx is a zip of a few XML parts, and
// jszip (already here for reading them) can write one. Nothing converts on a server,
// and the result opens in Whiteboard's own reader (docx-preview) and in Word alike.
//
// It covers what Claude writes — a title, headings, paragraphs, lists, quotes, code,
// rules and tables, with bold, italic, code and links — and nothing else.

import { parse } from "./markdown.js";

const plain = (runs) => runs.map((r) => r.text ?? plain(r.children ?? [])).join("");

export const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// Control characters are not legal in XML at all, and one pasted from a PDF would
// make Word call the whole file corrupt.
const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TEXT_WIDTH = 9360; // US Letter with one-inch margins, in twentieths of a point

function run(text, fmt) {
  const props = [
    fmt.link ? '<w:rStyle w:val="Hyperlink"/>' : fmt.code ? '<w:rStyle w:val="Code"/>' : "",
    fmt.b ? "<w:b/>" : "",
    fmt.i ? "<w:i/>" : "",
  ].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function runs(list, ctx, fmt = {}) {
  return list.map((r) => {
    switch (r.type) {
      case "strong": return runs(r.children, ctx, { ...fmt, b: true });
      case "em": return runs(r.children, ctx, { ...fmt, i: true });
      case "code": return run(r.text, { ...fmt, code: true });
      case "link": {
        const id = `rId${ctx.links.length + 3}`;
        ctx.links.push({ id, href: r.href });
        return `<w:hyperlink r:id="${id}">${runs(r.children, ctx, { ...fmt, link: true })}</w:hyperlink>`;
      }
      default: return run(r.text, fmt);
    }
  }).join("");
}

const para = (style, body, extra = "") =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${body}</w:p>`;

function table(b, ctx) {
  const cols = Math.max(1, b.head.length);
  const width = Math.floor(TEXT_WIDTH / cols);
  const cell = (content, head) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    (head ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/>' : "") +
    `</w:tcPr>${para("TableText", runs(content, ctx, head ? { b: true } : {}))}</w:tc>`;
  return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
    `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(cols)}</w:tblGrid>` +
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.head.map((c) => cell(c, true)).join("")}</w:tr>` +
    b.rows.map((r) => `<w:tr>${r.map((c) => cell(c, false)).join("")}</w:tr>`).join("") +
    // Word wants a paragraph after a table, and the gap is wanted anyway.
    "</w:tbl>" + para("Normal", "");
}

function blocks(list, ctx, style = "Normal") {
  return list.map((b) => {
    switch (b.type) {
      case "heading": return para(`Heading${Math.min(4, b.level)}`, runs(b.children, ctx));
      case "paragraph": return para(style, runs(b.children, ctx));
      case "rule":
        return para("Normal", "", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>');
      case "quote": return blocks(b.children, ctx, "Quote");
      case "code":
        return b.text.split("\n").map((line) => para("CodeBlock", line ? run(line, {}) : "")).join("");
      case "list": {
        // Each numbered list counts from one; bullets share a single definition.
        const numId = b.ordered ? 2 + ctx.ordered++ : 1;
        return b.items.map((it) => para("ListParagraph", runs(it.children, ctx),
          `<w:numPr><w:ilvl w:val="${it.depth}"/><w:numId w:val="${numId}"/></w:numPr>`)).join("");
      }
      case "table": return table(b, ctx);
      default: return "";
    }
  }).join("");
}

const font = (name) => `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:cs="${name}"/>`;
const style = (id, name, { based = "Normal", next, ppr = "", rpr = "", type = "paragraph" } = {}) =>
  `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>` +
  (id !== "Normal" && type === "paragraph" ? `<w:basedOn w:val="${based}"/>` : "") +
  (next ? `<w:next w:val="${next}"/>` : "") + "<w:qFormat/>" +
  (ppr ? `<w:pPr>${ppr}</w:pPr>` : "") + (rpr ? `<w:rPr>${rpr}</w:rPr>` : "") + "</w:style>";

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>` +
  `<w:docDefaults><w:rPrDefault><w:rPr>${font("Calibri")}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>` +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  style("Normal", "Normal") +
  style("Title", "Title", { next: "Normal", ppr: '<w:spacing w:after="240"/>', rpr: '<w:b/><w:sz w:val="48"/><w:szCs w:val="48"/>' }) +
  [[1, 34], [2, 28], [3, 25], [4, 22]].map(([n, sz]) =>
    style(`Heading${n}`, `heading ${n}`, { next: "Normal",
      ppr: `<w:keepNext/><w:spacing w:before="${n < 3 ? 280 : 200}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/>`,
      rpr: `<w:b/><w:color w:val="1F2937"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` })).join("") +
  style("ListParagraph", "List Paragraph", { ppr: '<w:spacing w:after="60"/><w:contextualSpacing/>' }) +
  style("Quote", "Quote", { ppr: '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BBBBBB"/></w:pBdr><w:ind w:left="480"/>', rpr: '<w:i/><w:color w:val="555555"/>' }) +
  style("CodeBlock", "Code Block", { ppr: '<w:shd w:val="clear" w:color="auto" w:fill="F3F3F3"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="120"/>', rpr: `${font("Consolas")}<w:sz w:val="19"/><w:szCs w:val="19"/>` }) +
  style("TableText", "Table Text", { ppr: '<w:spacing w:after="40"/>' }) +
  style("Code", "Code", { type: "character", rpr: `${font("Consolas")}<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>` }) +
  style("Hyperlink", "Hyperlink", { type: "character", rpr: '<w:color w:val="0563C1"/><w:u w:val="single"/>' }) +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
  ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`).join("") +
  '</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  "</w:styles>";

function numbering(ordered) {
  const level = (i, fmt, text) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/>` +
    `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`;
  const bullets = ["•", "◦", "▪"];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2].map((i) => level(i, "bullet", bullets[i])).join("")}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2].map((i) => level(i, ["decimal", "lowerLetter", "lowerRoman"][i], `%${i + 1}.`)).join("")}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    Array.from({ length: ordered }, (_, k) =>
      `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join("") +
    "</w:numbering>";
}

/** The parts of the file, as `{ path: xml }`. Pure, so it can be tested without a zip. */
export function docxParts(title, markdown) {
  const ctx = { links: [], ordered: 0 };
  const content = parse(markdown);
  // Claude often opens the text with the title again as a heading; it is already the
  // document's title, and twice is noise.
  const first = content[0];
  if (first?.type === "heading" && plain(first.children) === String(title).trim()) content.shift();
  const body = para("Title", run(title, {})) + blocks(content, ctx);
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const rel = (id, type, target, external) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ""}/>`;
  return {
    "[Content_Types].xml": head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
    "_rels/.rels": head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rel("rId1", "officeDocument", "word/document.xml") + "</Relationships>",
    "word/_rels/document.xml.rels": head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rel("rId1", "styles", "styles.xml") + rel("rId2", "numbering", "numbering.xml") +
      ctx.links.map((l) => rel(l.id, "hyperlink", l.href, true)).join("") + "</Relationships>",
    "word/document.xml": head + `<w:document ${NS}><w:body>${body}` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
    "word/styles.xml": head + STYLES.replace(/^<\?xml[^>]*\?>/, ""),
    "word/numbering.xml": numbering(ctx.ordered),
  };
}

/** A name that is safe to save as, ending in .docx. */
export function docxName(title) {
  const base = String(title ?? "").replace(/[\\/:*?"<>|\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${base || "Document"}.docx`;
}

/** The finished file. jszip is loaded here, so it stays out of the main bundle. */
export async function docxBlob(title, markdown, type = "blob") {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [path, xml] of Object.entries(docxParts(title, markdown))) zip.file(path, xml);
  return zip.generateAsync({ type, mimeType: DOCX_TYPE, compression: "DEFLATE" });
}
