import { describe, expect, it } from "vitest";
import {
  callErrorEnvelope,
  callNote,
  callResultNote,
  capCallResult,
} from "@vibegarden/agent-web";

import {
  AGENT_HISTORY_LIMIT,
  AGENT_MESSAGE_MAX_CHARS,
  AGENT_TOOL_TRANSPORT_MAX_CHARS,
  WORKBENCH_MAX_CONTINUATIONS,
  historyForModel,
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
        { role: "user", content: "x".repeat(AGENT_MESSAGE_MAX_CHARS + 1) },
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

  it("accepts capped tool transport content that compacts below the model cap", () => {
    const resultText = " \0".repeat(2_000);
    const envelope = capCallResult(resultText);
    const assistantContent = [
      "I will fetch that now.",
      callNote({
        tool: "fetch_page",
        args: { url: "https://example.com" },
      }),
      callResultNote(envelope),
    ].join("\n\n");
    const dataContent = JSON.stringify({ tool: "fetch_page", envelope });
    const raw = {
      versionId: "agentv_1",
      continuation: true,
      messages: [
        { role: "assistant", content: assistantContent },
        { role: "data", content: dataContent },
      ],
    } as const;

    expect(resultText).toHaveLength(4_000);
    expect(assistantContent.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);
    expect(dataContent.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);

    const parsed = parseAgentChatRequest(raw);
    expect(parsed).toEqual({ value: raw });
    if ("error" in parsed) throw new Error(parsed.error);

    const history = historyForModel(parsed.value.messages);
    expect(history).toEqual([
      {
        role: "assistant",
        content:
          'I will fetch that now.\n\n[ran fetch_page: {"url":"https://example.com"}]\n\n[fetch_page result: ok, 4000 chars]',
      },
      {
        role: "user",
        content: `Tool result for fetch_page:\n${resultText}`,
      },
    ]);
    expect(
      history.every(
        (message) => message.content.length <= AGENT_MESSAGE_MAX_CHARS,
      ),
    ).toBe(true);
  });

  it("rejects oversized call markers padded through duplicate args keys", () => {
    const duplicateArgs = `{"version":1,"tool":"fetch_page","args":{"padding":"${"x".repeat(9_000)}"},"args":{"url":"https://example.com"}}`;
    const content = `[[tool:call:${encodeURIComponent(duplicateArgs)}]]`;
    expect(content.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);
    expect(content.length).toBeLessThan(AGENT_TOOL_TRANSPORT_MAX_CHARS);

    expect(
      parseAgentChatRequest({
        versionId: "agentv_1",
        messages: [
          { role: "assistant", content },
          { role: "user", content: "Continue" },
        ],
      }),
    ).toHaveProperty("error");
  });

  it("rejects oversized call result markers padded through duplicate resultText keys", () => {
    const duplicateResultText = `{"status":"ok","resultText":"${"x".repeat(9_000)}","resultText":"page","totalChars":4,"truncated":false}`;
    const content = [
      callNote({ tool: "fetch_page", args: {} }),
      `[[tool:callresult:${encodeURIComponent(duplicateResultText)}]]`,
    ].join("\n");
    expect(content.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);
    expect(content.length).toBeLessThan(AGENT_TOOL_TRANSPORT_MAX_CHARS);

    expect(
      parseAgentChatRequest({
        versionId: "agentv_1",
        messages: [
          { role: "assistant", content },
          { role: "user", content: "Continue" },
        ],
      }),
    ).toHaveProperty("error");
  });

  it("rejects oversized continuation data padded with insignificant JSON whitespace", () => {
    const whitespace = " ".repeat(9_000);
    const content = `{"tool"${whitespace}:"fetch_page","envelope":{"status":"ok","resultText":"page","totalChars":4,"truncated":false}}`;
    expect(content.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);
    expect(content.length).toBeLessThan(AGENT_TOOL_TRANSPORT_MAX_CHARS);

    expect(
      parseAgentChatRequest({
        versionId: "agentv_1",
        continuation: true,
        messages: [{ role: "data", content }],
      }),
    ).toHaveProperty("error");
  });

  it("rejects oversized continuation data padded through duplicate resultText keys", () => {
    const content = `{"tool":"fetch_page","envelope":{"status":"ok","resultText":"${"x".repeat(9_000)}","resultText":"page","totalChars":4,"truncated":false}}`;
    expect(content.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);
    expect(content.length).toBeLessThan(AGENT_TOOL_TRANSPORT_MAX_CHARS);

    expect(
      parseAgentChatRequest({
        versionId: "agentv_1",
        continuation: true,
        messages: [{ role: "data", content }],
      }),
    ).toHaveProperty("error");
  });

  it("rejects a canonical 360 marker flood that compacts below the model cap", () => {
    const pair = [
      callNote({ tool: "x", args: {} }),
      callResultNote(callErrorEnvelope("")),
    ];
    const content = Array.from({ length: 180 }, () => pair).flat().join("\n");
    expect(content.split("\n")).toHaveLength(360);
    expect(content.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);
    expect(content.length).toBeLessThan(AGENT_TOOL_TRANSPORT_MAX_CHARS);

    expect(
      parseAgentChatRequest({
        versionId: "agentv_1",
        messages: [
          { role: "assistant", content },
          { role: "user", content: "Continue" },
        ],
      }),
    ).toHaveProperty("error");
  });

  it("rejects narration above the message cap alongside a valid trace", () => {
    const content = [
      "x".repeat(AGENT_MESSAGE_MAX_CHARS + 1),
      callNote({ tool: "fetch_page", args: {} }),
      callResultNote(capCallResult(" \0".repeat(2_000))),
    ].join("\n");
    expect(content.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);

    expect(
      parseAgentChatRequest({
        versionId: "agentv_1",
        messages: [
          { role: "assistant", content },
          { role: "user", content: "Continue" },
        ],
      }),
    ).toEqual({
      error: `Message content must be ${AGENT_MESSAGE_MAX_CHARS} characters or fewer.`,
    });
  });

  it.each([
    [
      "call",
      {
        version: 1,
        tool: "fetch_page",
        args: {},
        padding: "x".repeat(AGENT_MESSAGE_MAX_CHARS),
      },
    ],
    [
      "callresult",
      {
        ...capCallResult("page text"),
        padding: "x".repeat(AGENT_MESSAGE_MAX_CHARS),
      },
    ],
  ])("rejects oversized padded %s markers", (kind, payload) => {
    const content = `[[tool:${kind}:${encodeURIComponent(JSON.stringify(payload))}]]`;
    expect(content.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);
    expect(content.length).toBeLessThan(AGENT_TOOL_TRANSPORT_MAX_CHARS);

    expect(
      parseAgentChatRequest({
        versionId: "agentv_1",
        messages: [
          { role: "assistant", content },
          { role: "user", content: "Continue" },
        ],
      }),
    ).toEqual({
      error: `Message content must be ${AGENT_MESSAGE_MAX_CHARS} characters or fewer.`,
    });
  });

  it("rejects oversized continuation data with padding properties", () => {
    const envelope = capCallResult(" \0".repeat(2_000));
    const paddedContents = [
      JSON.stringify({
        tool: "fetch_page",
        envelope,
        padding: "ignored",
      }),
      JSON.stringify({
        tool: "fetch_page",
        envelope: { ...envelope, padding: "ignored" },
      }),
    ];

    for (const content of paddedContents) {
      expect(content.length).toBeGreaterThan(AGENT_MESSAGE_MAX_CHARS);
      expect(
        parseAgentChatRequest({
          versionId: "agentv_1",
          continuation: true,
          messages: [{ role: "data", content }],
        }),
      ).toHaveProperty("error");
    }
  });

  it("rejects compactable tool markers beyond the transport cap", () => {
    const oversizedMarker = callResultNote({
      status: "ok",
      resultText: "\0".repeat(6_000),
      totalChars: 6_000,
      truncated: false,
    });
    expect(oversizedMarker.length).toBeGreaterThan(
      AGENT_TOOL_TRANSPORT_MAX_CHARS,
    );

    expect(
      parseAgentChatRequest({
        versionId: "agentv_1",
        messages: [
          { role: "assistant", content: oversizedMarker },
          { role: "user", content: "Continue" },
        ],
      }),
    ).toEqual({
      error: `Message content must be ${AGENT_MESSAGE_MAX_CHARS} characters or fewer.`,
    });
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

  it("rejects message arrays above the bounded input limit", () => {
    const inputLimit = AGENT_HISTORY_LIMIT * 4;
    const messages = Array.from(
      { length: inputLimit + 1 },
      (_, index) => ({
        role: "user" as const,
        content: `message-${index}`,
      }),
    );

    expect(
      parseAgentChatRequest({ versionId: "agentv_1", messages }),
    ).toEqual({
      error: `messages must contain ${inputLimit} items or fewer.`,
    });
  });
});
