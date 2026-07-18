import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("~/lib/clubs.server", () => ({
  requireClubContext: vi.fn().mockResolvedValue({
    club: { id: "club-1", modelPolicy: "free_only" },
    membership: { modelPref: "model:free" },
  }),
}));
vi.mock("~/lib/club-ai.server", () => ({
  getClubChatCredential: vi.fn().mockResolvedValue("credential"),
  clubCredentialNeedsProvisioning: vi.fn(),
}));
vi.mock("~/lib/models", () => ({
  resolveClubModel: vi.fn().mockReturnValue({ id: "model:free", tools: false }),
}));
vi.mock("~/lib/db.server", () => ({ getDb: vi.fn().mockReturnValue({}) }));
vi.mock("~/lib/threads.server", () => ({
  ensureThread: vi.fn().mockResolvedValue({ id: "thread-1" }),
  saveMessage: vi.fn(),
  appendToLastAssistantMessage: vi.fn(),
  tagThreadWithProject: vi.fn(),
}));
vi.mock("~/lib/gardener.server", () => ({
  buildSystemPrompt: vi.fn().mockReturnValue("system"),
  trimHistory: vi.fn().mockReturnValue([]),
  readSseRound: vi.fn(),
}));
vi.mock("~/lib/gardener-tools.server", () => ({
  attachMarkerFor: vi.fn(),
  executeTool: vi.fn(),
  queryMarkerFor: vi.fn(),
  toolDefinitions: vi.fn(),
  toolNoteFor: vi.fn(),
}));
vi.mock("~/lib/query-tool", () => ({
  MAX_DATASETS: 8,
  parseAttachEnvelope: vi.fn(),
  parseEnvelope: vi.fn(),
}));
vi.mock("~/lib/tool-notes", () => ({ attachResultNote: vi.fn(), queryResultNote: vi.fn() }));

import { action } from "../api.chat";

describe("chat upstream failures", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockReset();
  });

  it("never logs a provider response body", async () => {
    const secret = "provider-body-secret-should-never-log";
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ detail: secret }), { status: 429 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await action({
      request: new Request("https://example.com/clubs/club-1/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      }),
      context: { get: () => ({ env: {} as Env }) },
      params: { clubSlug: "club-1" },
    } as never);

    expect(response.status).toBe(502);
    expect(error).toHaveBeenCalledWith(
      "OpenRouter request failed",
      429,
      "upstream_rejected",
    );
    expect(error.mock.calls.flat().join(" ")).not.toContain(secret);
  });
});
