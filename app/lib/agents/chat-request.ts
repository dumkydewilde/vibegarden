import type { AgentHistoryMessage } from "@vibegarden/agent-core";
import {
  parseCallResultEnvelope,
  toModelText,
  type CallResultEnvelope,
} from "@vibegarden/agent-web";

export const AGENT_MESSAGE_MAX_CHARS = 8_000;
export const AGENT_HISTORY_LIMIT = 30;
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

function parseContinuationResult(raw: string): ContinuationResult | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof parsed.tool !== "string" ||
      !parsed.tool.trim()
    ) {
      return null;
    }
    const envelope = parseCallResultEnvelope(JSON.stringify(parsed.envelope));
    return envelope ? { tool: parsed.tool, envelope } : null;
  } catch {
    return null;
  }
}

export function historyForModel(
  messages: AgentChatMessage[],
): AgentHistoryMessage[] {
  return messages.flatMap((message) => {
    if (message.role === "data") {
      const result = parseContinuationResult(message.content);
      if (!result) return [];
      const text =
        result.envelope.status === "ok"
          ? result.envelope.resultText
          : `Error: ${result.envelope.error}`;
      return [
        {
          role: "user" as const,
          content: `Tool result for ${result.tool}:\n${text}`,
        },
      ];
    }
    return [
      {
        role: message.role,
        content:
          message.role === "assistant"
            ? toModelText(message.content)
            : message.content,
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
      if (item.content.length > AGENT_MESSAGE_MAX_CHARS) {
        return {
          error: `Message content must be ${AGENT_MESSAGE_MAX_CHARS} characters or fewer.`,
        };
      }
      messages.push({
        role: item.role as AgentChatMessage["role"],
        content: item.content,
      });
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
