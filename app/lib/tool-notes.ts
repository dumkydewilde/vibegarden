/**
 * Tool activity notes travel inside the plain-text chat stream as marker
 * lines like `[[tool:article:what-is-an-llm]]`. The server emits them
 * between tool rounds; the chat UI renders them as separate little bubbles
 * (with a clickable card for articles and building blocks); history sent
 * back to the model has them stripped.
 */

export type ToolNoteKind = "article" | "module" | "web" | "note";

export type ToolNoteSegment =
  | { type: "text"; text: string }
  | { type: "tool"; kind: ToolNoteKind; value: string };

const NOTE_LINE = /^\[\[tool:(article|module|web|note):(.+?)\]\]$/;

export function toolNote(kind: ToolNoteKind, value: string): string {
  return `[[tool:${kind}:${value}]]`;
}

/** Break message text into text chunks and tool notes, in stream order. */
export function splitToolNotes(text: string): ToolNoteSegment[] {
  const segments: ToolNoteSegment[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const chunk = buffer.join("\n").trim();
    if (chunk) segments.push({ type: "text", text: chunk });
    buffer = [];
  };
  for (const line of text.split("\n")) {
    const match = line.trim().match(NOTE_LINE);
    if (match) {
      flush();
      segments.push({
        type: "tool",
        kind: match[1] as ToolNoteKind,
        value: match[2],
      });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return segments;
}

/** Message text without tool notes, for model-bound history. */
export function stripToolNotes(text: string): string {
  return splitToolNotes(text)
    .filter((s) => s.type === "text")
    .map((s) => s.text)
    .join("\n\n");
}
