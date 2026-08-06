import { describe, expect, it } from "vitest";

import {
  AGENT_HISTORY_LIMIT,
  AGENT_MESSAGE_MAX_CHARS,
  WORKBENCH_MAX_CONTINUATIONS,
  parseAgentChatRequest,
} from "../chat-request";

describe("parseAgentChatRequest", () => {
  it("rejects a missing version id", () => {
    const result = parseAgentChatRequest({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result).toEqual({ error: "versionId is required." });
  });

  it("rejects an empty message history", () => {
    const result = parseAgentChatRequest({
      versionId: "agentv_1",
      messages: [],
    });

    expect(result).toEqual({ error: "messages is required." });
  });

  it("rejects a non-user last message when the request is not a continuation", () => {
    const result = parseAgentChatRequest({
      versionId: "agentv_1",
      messages: [{ role: "assistant", content: "How can I help?" }],
    });

    expect(result).toEqual({ error: "The last message must be from the user." });
  });

  it("rejects oversized message content", () => {
    const result = parseAgentChatRequest({
      versionId: "agentv_1",
      messages: [
        { role: "assistant", content: "x".repeat(AGENT_MESSAGE_MAX_CHARS + 1) },
        { role: "user", content: "Hello" },
      ],
    });

    expect(result).toEqual({
      error: `Message content must be ${AGENT_MESSAGE_MAX_CHARS} characters or fewer.`,
    });
  });

  it("accepts a valid request", () => {
    const raw = {
      versionId: "agentv_1",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "What can you do?" },
      ],
    };

    expect(parseAgentChatRequest(raw)).toEqual({ value: raw });
  });

  it("accepts only a valid data envelope as a continuation", () => {
    const envelope = {
      status: "ok" as const,
      resultText: "page text",
      totalChars: 9,
      truncated: false,
    };
    const raw = {
      versionId: "agentv_1",
      continuation: true,
      messages: [
        { role: "user", content: "Fetch it" },
        {
          role: "data",
          content: JSON.stringify({ tool: "fetch_page", envelope }),
        },
      ],
    };

    expect(parseAgentChatRequest(raw)).toEqual({ value: raw });
    expect(WORKBENCH_MAX_CONTINUATIONS).toBe(5);

    expect(
      parseAgentChatRequest({
        ...raw,
        messages: [{ role: "assistant", content: "not tool data" }],
      }),
    ).toEqual({ error: "A continuation needs a valid tool result envelope." });
    expect(
      parseAgentChatRequest({
        ...raw,
        messages: [
          {
            role: "data",
            content: JSON.stringify({ tool: "fetch_page", envelope: {} }),
          },
        ],
      }),
    ).toEqual({ error: "A continuation needs a valid tool result envelope." });
  });

  it("trims a valid history to the newest messages", () => {
    const messages = Array.from(
      { length: AGENT_HISTORY_LIMIT + 4 },
      (_, index) => ({
        role: index % 2 === 0 ? "assistant" as const : "user" as const,
        content: `message-${index}`,
      }),
    );

    const result = parseAgentChatRequest({ versionId: "agentv_1", messages });

    expect(result).toEqual({
      value: {
        versionId: "agentv_1",
        messages: messages.slice(-AGENT_HISTORY_LIMIT),
      },
    });
  });
});
