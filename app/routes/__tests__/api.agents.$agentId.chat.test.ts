import { beforeEach, describe, expect, it, vi } from "vitest";

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
  getAgentForUser: vi.fn().mockResolvedValue({ definition: {} }),
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
});
