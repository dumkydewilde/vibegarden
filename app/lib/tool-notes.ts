/**
 * Tool activity notes travel inside the plain-text chat stream as marker
 * lines like `[[tool:article:what-is-an-llm]]`. The server emits them
 * between tool rounds; the chat UI renders them as separate little bubbles
 * (with a clickable card for articles and building blocks); history sent
 * back to the model has them stripped.
 */

export type ToolNoteKind = "article" | "module" | "web" | "note";

export type DiagramPayload = {
  version: 1;
  title: string;
  diagram: string;
};

export type ToolNoteSegment =
  | { type: "text"; text: string }
  | { type: "tool"; kind: ToolNoteKind; value: string }
  | { type: "diagram"; title: string; diagram: string };

const NOTE_LINE = /^\[\[tool:(article|module|web|note):(.+?)\]\]$/;
const DIAGRAM_LINE = /^\[\[tool:diagram:(.+?)\]\]$/;

export function toolNote(kind: ToolNoteKind, value: string): string {
  return `[[tool:${kind}:${value}]]`;
}

export function diagramNote(
  payload: Omit<DiagramPayload, "version">,
): string {
  return `[[tool:diagram:${encodeURIComponent(
    JSON.stringify({ version: 1, ...payload } satisfies DiagramPayload),
  )}]]`;
}

function decodeDiagram(value: string): DiagramPayload | null {
  try {
    const parsed = JSON.parse(
      decodeURIComponent(value),
    ) as Partial<DiagramPayload>;
    return parsed.version === 1 &&
      typeof parsed.title === "string" &&
      typeof parsed.diagram === "string"
      ? { version: 1, title: parsed.title, diagram: parsed.diagram }
      : null;
  } catch {
    return null;
  }
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
    const trimmed = line.trim();
    const diagramMatch = trimmed.match(DIAGRAM_LINE);
    if (diagramMatch) {
      const payload = decodeDiagram(diagramMatch[1]);
      if (payload) {
        flush();
        segments.push({
          type: "diagram",
          title: payload.title,
          diagram: payload.diagram,
        });
      } else {
        buffer.push(line);
      }
      continue;
    }

    const noteMatch = trimmed.match(NOTE_LINE);
    if (noteMatch) {
      flush();
      segments.push({
        type: "tool",
        kind: noteMatch[1] as ToolNoteKind,
        value: noteMatch[2],
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
