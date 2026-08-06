import { beforeEach, describe, expect, it, vi } from "vitest";
import { callNote } from "@vibegarden/agent-web";

const mocks = vi.hoisted(() => ({
  startTurn: vi.fn(),
  buildAgentSystemPrompt: vi.fn(),
}));

vi.mock("@vibegarden/agent-core", () => ({
  startTurn: mocks.startTurn,
}));
vi.mock("~/lib/auth.server", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("~/lib/clubs.server", () => ({
  requireClubContext: vi.fn().mockResolvedValue({
    club: {
      id: "club-1",
      name: "Example Club",
      modelPolicy: "free_only",
    },
    membership: { modelPref: "model:free" },
  }),
}));
vi.mock("~/lib/club-ai.server", () => ({
  getClubChatCredential: vi.fn().mockResolvedValue("credential"),
}));
vi.mock("~/lib/models", () => ({
  resolveClubModel: vi.fn().mockReturnValue({ id: "model:free" }),
}));
vi.mock("~/lib/db.server", () => ({ getDb: vi.fn().mockReturnValue({}) }));
vi.mock("~/lib/agents/repository.server", () => ({
  getAgentForUser: vi.fn().mockResolvedValue({
    definition: {
      version: 1,
      systemPrompt: "Be helpful.",
      tools: [],
      skills: [],
      builtins: { fetchPage: true, memory: true },
    },
  }),
}));
vi.mock("~/lib/agents/prompt.server", () => ({
  buildAgentSystemPrompt: mocks.buildAgentSystemPrompt,
}));

import { action } from "../api.agents.$agentId.chat";

describe("agent chat upstream failures", () => {
  beforeEach(() => {
    mocks.startTurn.mockReset();
    mocks.buildAgentSystemPrompt.mockReset().mockReturnValue("system");
  });

  it("returns 502 when starting the initial model request rejects", async () => {
    mocks.startTurn.mockRejectedValue(new TypeError("network unavailable"));

    const response = await action({
      request: new Request(
        "https://example.com/clubs/club-1/api/agents/agent-1/chat",
        {
          method: "POST",
          body: JSON.stringify({
            versionId: "version-1",
            messages: [{ role: "user", content: "hello" }],
          }),
        },
      ),
      context: { get: () => ({ env: {} }) },
      params: { clubSlug: "club-1", agentId: "agent-1" },
    } as never);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "The language model is not reachable right now.",
    });
  });

  it("does not convert prompt construction failures into model-unreachable responses", async () => {
    const promptError = new Error("invalid agent definition");
    mocks.buildAgentSystemPrompt.mockImplementation(() => {
      throw promptError;
    });

    await expect(
      action({
        request: new Request(
          "https://example.com/clubs/club-1/api/agents/agent-1/chat",
          {
            method: "POST",
            body: JSON.stringify({
              versionId: "version-1",
              messages: [{ role: "user", content: "hello" }],
            }),
          },
        ),
        context: { get: () => ({ env: {} }) },
        params: { clubSlug: "club-1", agentId: "agent-1" },
      } as never),
    ).rejects.toThrow(promptError);
    expect(mocks.startTurn).not.toHaveBeenCalled();
  });

  it("offers tools on a continuation and emits a terminal call marker", async () => {
    mocks.startTurn.mockResolvedValue({
      ok: true,
      events: (async function* () {
        yield {
          type: "delegated-call" as const,
          tool: "fetch_page",
          payload: { url: "https://example.com/next" },
        };
      })(),
    });
    const resultText = "x".repeat(4_000);

    const response = await action({
      request: new Request(
        "https://example.com/clubs/club-1/api/agents/agent-1/chat",
        {
          method: "POST",
          body: JSON.stringify({
            versionId: "version-1",
            continuation: true,
            messages: [
              {
                role: "assistant",
                content: callNote({
                  tool: "fetch_page",
                  args: { url: "https://example.com" },
                }),
              },
              {
                role: "data",
                content: JSON.stringify({
                  tool: "fetch_page",
                  envelope: {
                    status: "ok",
                    resultText,
                    totalChars: resultText.length,
                    truncated: false,
                  },
                }),
              },
            ],
          }),
        },
      ),
      context: { get: () => ({ env: {} }) },
      params: { clubSlug: "club-1", agentId: "agent-1" },
    } as never);

    expect(response.status).toBe(200);
    const marker = await response.text();
    expect(marker).toMatch(/^\[\[tool:call:/);
    expect(marker).not.toMatch(/\n$/);

    const [config, history] = mocks.startTurn.mock.calls[0] ?? [];
    expect(config.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "fetch_page",
      "remember",
      "recall",
    ]);
    expect(history).toEqual([
      {
        role: "assistant",
        content: '[ran fetch_page: {"url":"https://example.com"}]',
      },
      {
        role: "user",
        content: `Tool result for fetch_page:\n${"x".repeat(4_000)}`,
      },
    ]);
  });

  it("rejects a continuation for a tool that was not offered", async () => {
    mocks.startTurn.mockResolvedValue({
      ok: true,
      events: (async function* () {})(),
    });
    const response = await action({
      request: new Request(
        "https://example.com/clubs/club-1/api/agents/agent-1/chat",
        {
          method: "POST",
          body: JSON.stringify({
            versionId: "version-1",
            continuation: true,
            messages: [
              {
                role: "assistant",
                content: callNote({ tool: "delete_everything", args: {} }),
              },
              {
                role: "data",
                content: JSON.stringify({
                  tool: "delete_everything",
                  envelope: {
                    status: "error",
                    error: "No executor found.",
                  },
                }),
              },
            ],
          }),
        },
      ),
      context: { get: () => ({ env: {} }) },
      params: { clubSlug: "club-1", agentId: "agent-1" },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The continuation does not match an offered tool call.",
    });
    expect(mocks.startTurn).not.toHaveBeenCalled();
  });

  it("rejects a continuation that mismatches the preceding call marker", async () => {
    mocks.startTurn.mockResolvedValue({
      ok: true,
      events: (async function* () {})(),
    });
    const response = await action({
      request: new Request(
        "https://example.com/clubs/club-1/api/agents/agent-1/chat",
        {
          method: "POST",
          body: JSON.stringify({
            versionId: "version-1",
            continuation: true,
            messages: [
              {
                role: "assistant",
                content: callNote({ tool: "remember", args: {} }),
              },
              {
                role: "data",
                content: JSON.stringify({
                  tool: "fetch_page",
                  envelope: {
                    status: "ok",
                    resultText: "page text",
                    totalChars: 9,
                    truncated: false,
                  },
                }),
              },
            ],
          }),
        },
      ),
      context: { get: () => ({ env: {} }) },
      params: { clubSlug: "club-1", agentId: "agent-1" },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The continuation does not match an offered tool call.",
    });
    expect(mocks.startTurn).not.toHaveBeenCalled();
  });
});
