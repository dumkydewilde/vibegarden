import type { AgentHistoryMessage } from "@vibegarden/agent-core";
import {
  CALL_RESULT_MAX_CHARS,
  callNote,
  callResultNote,
  parseCallResultEnvelope,
  splitToolNotes,
  toModelText,
  type CallResultEnvelope,
} from "@vibegarden/agent-web";

import { TOOL_NAME_RE } from "./contracts";

export const AGENT_MESSAGE_MAX_CHARS = 8_000;
// JSON escaping plus URI encoding can expand one result character to 8 chars.
export const AGENT_TOOL_TRANSPORT_MAX_CHARS =
  AGENT_MESSAGE_MAX_CHARS + CALL_RESULT_MAX_CHARS * 8 + 1_000;
export const AGENT_HISTORY_LIMIT = 30;
export const AGENT_HISTORY_INPUT_LIMIT = AGENT_HISTORY_LIMIT * 4;
export const WORKBENCH_MAX_CONTINUATIONS = 5;

export type AgentChatMessage = {
  role: "user" | "assistant" | "data";
  content: string;
};

type ContinuationResult = {
  tool: string;
  envelope: CallResultEnvelope;
};

export type AgentChatRequest = {
  messages: AgentChatMessage[];
  versionId: string;
  continuation?: boolean;
};

const MESSAGE_ROLES = new Set<AgentChatMessage["role"]>([
  "user",
  "assistant",
  "data",
]);

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function parseStrictCallResultEnvelope(raw: unknown): CallResultEnvelope | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const envelope = raw as Record<string, unknown>;
  if (envelope.status === "error") {
    if (
      !hasExactKeys(envelope, ["status", "error"]) ||
      typeof envelope.error !== "string"
    ) {
      return null;
    }
  } else if (envelope.status === "ok") {
    if (
      !hasExactKeys(envelope, [
        "status",
        "resultText",
        "totalChars",
        "truncated",
      ]) ||
      typeof envelope.resultText !== "string" ||
      typeof envelope.totalChars !== "number" ||
      !Number.isSafeInteger(envelope.totalChars) ||
      envelope.totalChars < envelope.resultText.length ||
      typeof envelope.truncated !== "boolean"
    ) {
      return null;
    }
  } else {
    return null;
  }
  return parseCallResultEnvelope(JSON.stringify(envelope));
}

function parseContinuationResult(raw: string): ContinuationResult | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !hasExactKeys(parsed, ["tool", "envelope"]) ||
      typeof parsed.tool !== "string" ||
      !TOOL_NAME_RE.test(parsed.tool)
    ) {
      return null;
    }
    const envelope = parseStrictCallResultEnvelope(parsed.envelope);
    return envelope ? { tool: parsed.tool, envelope } : null;
  } catch {
    return null;
  }
}

function canonicalContinuationResult(result: ContinuationResult): string {
  return JSON.stringify({ tool: result.tool, envelope: result.envelope });
}

function contentForModel(message: AgentChatMessage): string | null {
  if (message.role === "data") {
    const result = parseContinuationResult(message.content);
    if (!result) return null;
    const text =
      result.envelope.status === "ok"
        ? result.envelope.resultText
        : `Error: ${result.envelope.error}`;
    return `Tool result for ${result.tool}:\n${text}`;
  }
  return message.role === "assistant"
    ? toModelText(message.content)
    : message.content;
}

type TraceMarker =
  | { status: "not-marker" }
  | { status: "invalid" }
  | {
      status: "valid";
      type: "call";
      tool: string;
    }
  | { status: "valid"; type: "callresult"; result: CallResultEnvelope };

function canonicalTraceMarker(raw: string): TraceMarker {
  const segments = splitToolNotes(raw);
  if (segments.length !== 1) return { status: "not-marker" };
  const segment = segments[0];
  if (segment?.type === "call") {
    const canonical = callNote({ tool: segment.tool, args: segment.args });
    return canonical === raw
      ? {
          status: "valid",
          type: "call",
          tool: segment.tool,
        }
      : { status: "invalid" };
  }
  if (segment?.type === "callresult") {
    const canonical = callResultNote(segment.result);
    return canonical === raw
      ? { status: "valid", type: "callresult", result: segment.result }
      : { status: "invalid" };
  }
  return { status: "not-marker" };
}

type TraceCall = {
  tool: string;
  result?: CallResultEnvelope;
};

type WorkbenchTrace =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "valid"; calls: TraceCall[]; textChars: number };

function hasGenericMarker(content: string): boolean {
  return (
    content.includes("[[tool:call:") ||
    content.includes("[[tool:callresult:")
  );
}

function parseWorkbenchTrace(content: string): WorkbenchTrace {
  const calls: TraceCall[] = [];
  let textChars = content.length;
  let expectedType: "call" | "callresult" = "call";
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const marker = canonicalTraceMarker(trimmed);
    if (marker.status === "invalid") return { status: "invalid" };
    if (marker.status === "not-marker") {
      if (hasGenericMarker(line)) return { status: "invalid" };
      continue;
    }

    if (marker.type !== expectedType) return { status: "invalid" };
    if (marker.type === "call") {
      calls.push({ tool: marker.tool });
      if (calls.length > WORKBENCH_MAX_CONTINUATIONS) {
        return { status: "invalid" };
      }
      expectedType = "callresult";
    } else {
      const call = calls.at(-1);
      if (!call) return { status: "invalid" };
      call.result = marker.result;
      expectedType = "call";
    }
    textChars -= trimmed.length;
  }
  if (calls.length === 0) {
    return hasGenericMarker(content)
      ? { status: "invalid" }
      : { status: "none" };
  }
  return { status: "valid", calls, textChars };
}

function isValidMessageTransport(message: AgentChatMessage): boolean {
  if (message.role === "user") {
    return message.content.length <= AGENT_MESSAGE_MAX_CHARS;
  }
  if (message.content.length > AGENT_TOOL_TRANSPORT_MAX_CHARS) return false;

  if (message.role === "assistant") {
    const trace = parseWorkbenchTrace(message.content);
    if (trace.status === "invalid") return false;
    if (trace.status === "none") {
      return message.content.length <= AGENT_MESSAGE_MAX_CHARS;
    }
    if (trace.textChars > AGENT_MESSAGE_MAX_CHARS) return false;
  }
  if (message.role === "data") {
    const result = parseContinuationResult(message.content);
    if (
      !result ||
      canonicalContinuationResult(result) !== message.content
    ) {
      return false;
    }
  }
  const modelContent = contentForModel(message);
  return modelContent !== null && modelContent.length <= AGENT_MESSAGE_MAX_CHARS;
}

export function continuationMatchesOfferedTool(
  messages: AgentChatMessage[],
  offeredToolNames: ReadonlySet<string>,
): boolean {
  const dataMessage = messages.at(-1);
  const assistantMessage = messages.at(-2);
  if (dataMessage?.role !== "data" || assistantMessage?.role !== "assistant") {
    return false;
  }
  const result = parseContinuationResult(dataMessage.content);
  if (!result || !offeredToolNames.has(result.tool)) return false;
  const trace = parseWorkbenchTrace(assistantMessage.content);
  if (trace.status !== "valid") return false;
  const call = trace.calls.at(-1);
  if (!call || call.tool !== result.tool) return false;
  return (
    call.result === undefined ||
    callResultNote(call.result) === callResultNote(result.envelope)
  );
}

export function historyForModel(
  messages: AgentChatMessage[],
): AgentHistoryMessage[] {
  return messages.flatMap((message) => {
    const content = contentForModel(message);
    if (content === null) return [];
    return [
      {
        role: message.role === "data" ? "user" as const : message.role,
        content,
      },
    ];
  });
}

export function parseAgentChatRequest(
  raw: unknown,
): { value: AgentChatRequest } | { error: string } {
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { error: "The request body must be an object." };
    }

    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.versionId !== "string" || !candidate.versionId.trim()) {
      return { error: "versionId is required." };
    }
    if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
      return { error: "messages is required." };
    }
    if (candidate.messages.length > AGENT_HISTORY_INPUT_LIMIT) {
      return {
        error: `messages must contain ${AGENT_HISTORY_INPUT_LIMIT} items or fewer.`,
      };
    }
    if (
      candidate.continuation !== undefined &&
      typeof candidate.continuation !== "boolean"
    ) {
      return { error: "continuation must be a boolean." };
    }

    const messages: AgentChatMessage[] = [];
    for (const message of candidate.messages) {
      if (
        typeof message !== "object" ||
        message === null ||
        Array.isArray(message)
      ) {
        return { error: "Each message must be an object." };
      }
      const item = message as Record<string, unknown>;
      if (
        typeof item.role !== "string" ||
        !MESSAGE_ROLES.has(item.role as AgentChatMessage["role"])
      ) {
        return { error: "Each message needs a valid role." };
      }
      if (typeof item.content !== "string") {
        return { error: "Each message needs string content." };
      }
      const normalizedMessage = {
        role: item.role as AgentChatMessage["role"],
        content: item.content,
      };
      if (!isValidMessageTransport(normalizedMessage)) {
        if (normalizedMessage.role === "data") {
          return {
            error: "A continuation needs a valid tool result envelope.",
          };
        }
        return {
          error: `Message content must be ${AGENT_MESSAGE_MAX_CHARS} characters or fewer.`,
        };
      }
      messages.push(normalizedMessage);
    }

    const continuation = candidate.continuation === true;
    const lastMessage = messages[messages.length - 1];
    if (
      continuation &&
      (lastMessage.role !== "data" ||
        parseContinuationResult(lastMessage.content) === null)
    ) {
      return { error: "A continuation needs a valid tool result envelope." };
    }
    if (
      !continuation &&
      (lastMessage.role !== "user" || !lastMessage.content.trim())
    ) {
      return { error: "The last message must be from the user." };
    }

    return {
      value: {
        versionId: candidate.versionId,
        messages: messages.slice(-AGENT_HISTORY_LIMIT),
        ...(candidate.continuation === undefined
          ? {}
          : { continuation: candidate.continuation }),
      },
    };
  } catch {
    return { error: "The request body could not be parsed safely." };
  }
}
