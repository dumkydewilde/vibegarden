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
import { action } from "../api.chat";
import { resolveClubModel } from "~/lib/models";

function sseResponse(deltas: object[]) {
  return new Response(
    [
      ...deltas.map((delta) =>
        `data: ${JSON.stringify({ choices: [delta] })}`,
      ),
      "data: [DONE]",
      "",
    ].join("\n\n"),
    { status: 200 },
  );
}

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

  it("streams article recommendation events as web markers", async () => {
    vi.mocked(resolveClubModel).mockReturnValueOnce({
      id: "model:free",
      label: "Tool model",
      note: "free",
      tools: true,
    });
    mocks.fetch
      .mockResolvedValueOnce(
        sseResponse([
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_articles",
                  function: {
                    name: "recommend_articles",
                    arguments: JSON.stringify({
                      slugs: ["what-is-an-llm", "what-is-an-agent"],
                    }),
                  },
                },
              ],
            },
          },
          { delta: {}, finish_reason: "tool_calls" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { delta: { content: "These are two useful starting points." } },
          { delta: {}, finish_reason: "stop" },
        ]),
      );

    const response = await action({
      request: new Request("https://example.com/clubs/club-1/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "Any interesting articles?" }],
        }),
      }),
      context: { get: () => ({ env: {} as Env }) },
      params: { clubSlug: "club-1" },
    } as never);

    const text = await response.text();
    expect(text).toContain("[[tool:articles:");
    expect(text).toContain("These are two useful starting points.");
  });
});
