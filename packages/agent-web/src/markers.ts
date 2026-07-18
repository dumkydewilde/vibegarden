/**
 * Tool activity notes travel inside the plain-text chat stream as marker
 * lines like `[[tool:article:what-is-an-llm]]`. The server emits them
 * between tool rounds; the chat UI renders them as separate little bubbles
 * (with a clickable card for articles and building blocks); history sent
 * back to the model has them stripped or compacted.
 *
 * Data queries use a marker pair: `[[tool:query:...]]` carries the SQL the
 * model wants to run (the browser executes it), and `[[tool:queryresult:...]]`
 * carries the capped result the browser produced, appended right after it.
 * Model-initiated data attachments work the same way: `[[tool:attach:...]]`
 * carries the URL the browser should load, `[[tool:attachresult:...]]` what
 * came of it.
 */

import type { AgentEvent } from "@vibegarden/agent-core";
import {
  attachSummaryLine,
  envelopeSummaryLine,
  parseAttachEnvelope,
  parseChartSpec,
  type AttachResultEnvelope,
  type ChartSpec,
  type QueryResultEnvelope,
} from "./query";

export type ToolNoteKind = "article" | "module" | "web" | "note";

const NOTE_KINDS: readonly string[] = ["article", "module", "web", "note"];

/**
 * Serialize one agent event into the web marker format, or null when the
 * event has no marker (text, done, error). This is the web surface's
 * rendering of the surface-agnostic event stream.
 */
export function markerForEvent(event: AgentEvent): string | null {
  switch (event.type) {
    case "note":
      return toolNote(
        NOTE_KINDS.includes(event.kind)
          ? (event.kind as ToolNoteKind)
          : "note",
        event.value,
      );
    case "diagram":
      return diagramNote({ title: event.title, diagram: event.diagram });
    case "delegated-call": {
      if (event.tool === "query_data") {
        const payload = event.payload as { sql?: unknown; chart?: unknown };
        if (typeof payload?.sql !== "string" || !payload.sql) return null;
        return queryNote({
          sql: payload.sql,
          chart: parseChartSpec(payload.chart),
        });
      }
      if (event.tool === "attach_data") {
        const payload = event.payload as { url?: unknown };
        return typeof payload?.url === "string" && payload.url
          ? attachNote({ url: payload.url })
          : null;
      }
      return null;
    }
    default:
      return null;
  }
}

export type DiagramPayload = {
  version: 1;
  title: string;
  diagram: string;
};

export type QueryPayload = {
  version: 1;
  sql: string;
  chart?: ChartSpec;
};

export type AttachPayload = {
  version: 1;
  url: string;
};

export type ToolNoteSegment =
  | { type: "text"; text: string }
  | { type: "tool"; kind: ToolNoteKind; value: string }
  | { type: "diagram"; title: string; diagram: string }
  | { type: "query"; sql: string; chart?: ChartSpec }
  | { type: "queryresult"; result: QueryResultEnvelope }
  | { type: "attach"; url: string }
  | { type: "attachresult"; result: AttachResultEnvelope };

const NOTE_LINE = /^\[\[tool:(article|module|web|note):(.+?)\]\]$/;
const DIAGRAM_LINE = /^\[\[tool:diagram:(.+?)\]\]$/;
const QUERY_LINE = /^\[\[tool:query:(.+?)\]\]$/;
const QUERY_RESULT_LINE = /^\[\[tool:queryresult:(.+?)\]\]$/;
const ATTACH_LINE = /^\[\[tool:attach:(.+?)\]\]$/;
const ATTACH_RESULT_LINE = /^\[\[tool:attachresult:(.+?)\]\]$/;

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

export function queryNote(payload: Omit<QueryPayload, "version">): string {
  return `[[tool:query:${encodeURIComponent(
    JSON.stringify({ version: 1, ...payload } satisfies QueryPayload),
  )}]]`;
}

export function queryResultNote(result: QueryResultEnvelope): string {
  return `[[tool:queryresult:${encodeURIComponent(JSON.stringify(result))}]]`;
}

export function attachNote(payload: Omit<AttachPayload, "version">): string {
  return `[[tool:attach:${encodeURIComponent(
    JSON.stringify({ version: 1, ...payload } satisfies AttachPayload),
  )}]]`;
}

export function attachResultNote(result: AttachResultEnvelope): string {
  return `[[tool:attachresult:${encodeURIComponent(JSON.stringify(result))}]]`;
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

function decodeQuery(value: string): QueryPayload | null {
  try {
    const parsed = JSON.parse(
      decodeURIComponent(value),
    ) as Partial<QueryPayload>;
    return parsed.version === 1 && typeof parsed.sql === "string" && parsed.sql
      ? { version: 1, sql: parsed.sql, chart: parseChartSpec(parsed.chart) }
      : null;
  } catch {
    return null;
  }
}

function decodeAttach(value: string): AttachPayload | null {
  try {
    const parsed = JSON.parse(
      decodeURIComponent(value),
    ) as Partial<AttachPayload>;
    return parsed.version === 1 && typeof parsed.url === "string" && parsed.url
      ? { version: 1, url: parsed.url }
      : null;
  } catch {
    return null;
  }
}

function decodeAttachResult(value: string): AttachResultEnvelope | null {
  try {
    return parseAttachEnvelope(decodeURIComponent(value));
  } catch {
    return null;
  }
}

function decodeQueryResult(value: string): QueryResultEnvelope | null {
  try {
    const parsed = JSON.parse(
      decodeURIComponent(value),
    ) as QueryResultEnvelope;
    if (parsed.status === "error" && typeof parsed.error === "string") {
      return parsed;
    }
    if (
      parsed.status === "ok" &&
      Array.isArray(parsed.columns) &&
      Array.isArray(parsed.rows)
    ) {
      return parsed;
    }
    return null;
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

    const queryMatch = trimmed.match(QUERY_LINE);
    if (queryMatch) {
      const payload = decodeQuery(queryMatch[1]);
      if (payload) {
        flush();
        segments.push({
          type: "query",
          sql: payload.sql,
          chart: payload.chart,
        });
      } else {
        buffer.push(line);
      }
      continue;
    }

    const resultMatch = trimmed.match(QUERY_RESULT_LINE);
    if (resultMatch) {
      const payload = decodeQueryResult(resultMatch[1]);
      if (payload) {
        flush();
        segments.push({ type: "queryresult", result: payload });
      } else {
        buffer.push(line);
      }
      continue;
    }

    const attachResultMatch = trimmed.match(ATTACH_RESULT_LINE);
    if (attachResultMatch) {
      const payload = decodeAttachResult(attachResultMatch[1]);
      if (payload) {
        flush();
        segments.push({ type: "attachresult", result: payload });
      } else {
        buffer.push(line);
      }
      continue;
    }

    const attachMatch = trimmed.match(ATTACH_LINE);
    if (attachMatch) {
      const payload = decodeAttach(attachMatch[1]);
      if (payload) {
        flush();
        segments.push({ type: "attach", url: payload.url });
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

/**
 * Strip stray tool-echo fragments a model sometimes parrots back from the
 * compacted history: `[ran query_data: ...]`, `[query result: ...]`, a
 * bracketed chart description, and a bare `chart={...}` line. These never
 * occur in real prose, and the single brackets never match the double-bracket
 * `[[tool:...]]` markers. Applied both to displayed text and to model-bound
 * history (so it cannot re-prime).
 */
export function stripToolEcho(text: string): string {
  return text
    .replace(/\[ran query_data:[^\]]*\]/gi, "")
    .replace(/\[query results?:[^\]]*\]/gi, "")
    .replace(/\[chart\b[^\]]*\](?!\()/gi, "")
    .replace(/^\s*chart\s*=\s*\{[^}]*\}\s*$/gim, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Message text for model-bound history: plain text kept, activity notes and
 * diagrams dropped, query markers compacted to one-liners so the model
 * remembers what SQL ran and what came back without re-reading full results.
 */
export function toModelText(text: string): string {
  return splitToolNotes(text)
    .map((s) => {
      if (s.type === "text") {
        const clean = stripToolEcho(s.text);
        return clean || null;
      }
      if (s.type === "query") {
        return `[ran query_data: ${s.sql.replace(/\s+/g, " ").slice(0, 300)}]`;
      }
      if (s.type === "queryresult") return envelopeSummaryLine(s.result);
      if (s.type === "attach") {
        return `[ran attach_data: ${s.url.slice(0, 300)}]`;
      }
      if (s.type === "attachresult") return attachSummaryLine(s.result);
      return null;
    })
    .filter(Boolean)
    .join("\n\n");
}
