// Saved chats: what a chat is called, what is said to Claude when one is picked up
// again, and how a stored one is made safe to show. Pure, so it is tested.

const TITLE_MAX = 48;

/** A chat's first name: its first message, trimmed to a line that fits a list. */
export function titleFrom(text, max = TITLE_MAX) {
  const first = String(text ?? "").split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  const plain = first.replace(/[*_`#>[\]]/g, "").replace(/\s+/g, " ").trim();
  if (!plain) return "New chat";
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** What a stored chat's messages should look like on screen. A lookup that was still
 * running when the page closed never finished, and an answer that never started is
 * nothing to show. */
export function revive(messages) {
  return (messages ?? [])
    .map((m) => m.role !== "assistant" ? m : {
      ...m,
      parts: m.parts.map((p) => p.type === "tool" && p.status === "running" ? { ...p, status: "failed" } : p),
    })
    .filter((m) => m.role !== "assistant" || m.parts.length > 0 || m.error);
}

/** The conversation so far as plain text, for Claude to pick up from. Claude itself
 * has forgotten it — each run is a fresh process — and lookups are left out: it can
 * make them again, and a transcript full of course text would drown the conversation.
 * The most recent turns are kept when it is too long. */
export function transcript(messages, items = [], max = 24000) {
  const lines = (messages ?? []).map((m) => {
    if (m.role === "user") return `Student: ${m.parts?.[0]?.text ?? ""}`;
    const said = m.parts.map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "item") {
        const item = items.find((i) => i.id === p.itemId);
        return item ? `(you made the ${item.kind === "quiz" ? "quiz" : "document"} "${item.title}")` : "";
      }
      return "";
    }).filter(Boolean).join("\n");
    return said ? `You: ${said}` : "";
  }).filter(Boolean);
  let out = lines.join("\n\n");
  if (out.length > max) {
    out = out.slice(-max);
    out = `[earlier conversation omitted]\n${out.slice(out.indexOf("\n") + 1)}`;
  }
  return out;
}
