import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMcpAuthContext: vi.fn(),
}));

vi.mock("agents/mcp", () => mocks);

import {
  getMcpPrincipal,
  hashMcpUser,
  oauthChallenge,
  requireScope,
  runMcpTool,
} from "~/lib/mcp/auth.server";
import { BODY_MAX_CHARS, RESPONSE_MAX_CHARS } from "~/lib/mcp/contracts";

const generalLimit = vi.fn();
const historyLimit = vi.fn();
const clubAccess = vi.fn();
const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

function mockMcpAuthContext(context: unknown) {
  mocks.getMcpAuthContext.mockReturnValue(context);
}

function env(): Env {
  return {
    APP_ORIGIN: "https://vibegarden.example",
    SESSION_SECRET: "worker-test-session-secret",
    MCP_GENERAL_LIMITER: { limit: generalLimit },
    MCP_HISTORY_LIMITER: { limit: historyLimit },
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: clubAccess })),
      })),
    },
  } as Env;
}

beforeEach(() => {
  mockMcpAuthContext({
    props: { userId: "user-a", clubId: "club-a", scopes: ["projects:read", "content:read"] },
  });
  generalLimit.mockResolvedValue({ success: true });
  historyLimit.mockResolvedValue({ success: true });
  clubAccess.mockResolvedValue({ clubSlug: "wotf", clubName: "WOTF Club" });
  consoleInfo.mockClear();
  consoleError.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("hashMcpUser", () => {
  it("returns the deterministic first 24 hex characters of an HMAC-SHA-256 without exposing the raw value", async () => {
    const rawUserId = "user-a";
    const env = { SESSION_SECRET: "worker-test-session-secret" } as Env;

    const firstHash = await hashMcpUser(env, rawUserId);
    const secondHash = await hashMcpUser(env, rawUserId);

    expect(firstHash).toBe("b0c1ad50abc26086e8f15c6e");
    expect(secondHash).toBe(firstHash);
    expect(firstHash).toMatch(/^[0-9a-f]{24}$/);
    expect(firstHash).not.toContain(rawUserId);
  });

  it.each([undefined, ""])(
    "rejects a missing SESSION_SECRET (%s)",
    async (sessionSecret) => {
      const env = { SESSION_SECRET: sessionSecret } as Env;

      await expect(hashMcpUser(env, "user-a")).rejects.toThrow(
        /SESSION_SECRET is not set/,
      );
    },
  );
});

describe("MCP tool auth wrapper", () => {
  it("accepts only server-issued principal properties", () => {
    mockMcpAuthContext({
      props: { userId: "user-a", clubId: "club-a", scopes: ["projects:read", "unknown"] },
    });

    expect(getMcpPrincipal()).toEqual({
      userId: "user-a",
      clubId: "club-a",
      scopes: ["projects:read"],
    });
  });

  it.each([
    undefined,
    { props: { userId: "", scopes: [] } },
    { props: { userId: 1, scopes: [] } },
    { props: { userId: "user-a", scopes: [] } },
    { props: { userId: "user-a", scopes: "projects:read" } },
  ])("rejects an invalid verified auth context (%j)", (context) => {
    mockMcpAuthContext(context);

    expect(() => getMcpPrincipal()).toThrow(/request could not be completed/i);
  });

  it("returns an OAuth challenge for a missing scope", async () => {
    mockMcpAuthContext({ props: { userId: "user-a", clubId: "club-a", scopes: ["projects:read"] } });
    const handler = vi.fn(async () => ({ title: "Never reached" }));

    const result = await runMcpTool({
      env: env(),
      toolName: "read_article",
      requestId: "request-1",
      requiredScope: "content:read",
      limiter: "general",
    }, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      isError: true,
      _meta: {
        "mcp/www_authenticate": [expect.stringContaining("insufficient_scope")],
      },
    });
  });

  it("resolves the active club before invoking a tool", async () => {
    const handler = vi.fn(async (principal) => ({
      club_id: principal.clubId,
      club_slug: principal.clubSlug,
    }));

    const result = await runMcpTool({
      env: env(),
      toolName: "list_projects",
      requestId: "request-club",
      requiredScope: "projects:read",
      limiter: "general",
    }, handler);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-a",
      clubId: "club-a",
      clubSlug: "wotf",
      clubName: "WOTF Club",
    }));
    expect(result.structuredContent).toEqual({
      club_id: "club-a",
      club_slug: "wotf",
    });
  });

  it("fails closed when the token's club membership is no longer active", async () => {
    clubAccess.mockResolvedValue(null);
    const handler = vi.fn(async () => ({ title: "Never reached" }));

    const result = await runMcpTool({
      env: env(),
      toolName: "list_projects",
      requestId: "request-revoked",
      requiredScope: "projects:read",
      limiter: "general",
    }, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("not_found");
  });

  it("uses the history limiter only for get_conversation", async () => {
    const currentEnv = env();

    await runMcpTool({
      env: currentEnv,
      toolName: "get_conversation",
      requestId: "request-1",
      requiredScope: "projects:read",
      limiter: "history",
    }, async () => ({ title: "Conversation" }));

    expect(historyLimit).toHaveBeenCalledWith({
      key: "b0c1ad50abc26086e8f15c6e:get_conversation",
    });
    expect(generalLimit).not.toHaveBeenCalled();
  });

  it("uses the general limiter for every non-conversation tool", async () => {
    const currentEnv = env();

    await runMcpTool({
      env: currentEnv,
      toolName: "read_article",
      requestId: "request-1",
      requiredScope: "content:read",
      limiter: "history",
    }, async () => ({ title: "Article" }));

    expect(generalLimit).toHaveBeenCalledWith({
      key: "b0c1ad50abc26086e8f15c6e:read_article",
    });
    expect(historyLimit).not.toHaveBeenCalled();
  });

  it("allows a tool to require either approved read scope", async () => {
    mockMcpAuthContext({
      props: { userId: "user-a", clubId: "club-a", scopes: ["content:read"] },
    });

    const result = await runMcpTool({
      env: env(),
      toolName: "search",
      requestId: "request-1",
      requiredScope: ["projects:read", "content:read"],
      limiter: "general",
    }, async () => ({ results: [] }));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ results: [] });
  });

  it("returns retry guidance when a limiter rejects a request", async () => {
    generalLimit.mockResolvedValue({ success: false });

    const result = await runMcpTool({
      env: env(),
      toolName: "read_article",
      requestId: "request-1",
      requiredScope: "content:read",
      limiter: "general",
    }, async () => ({ title: "Never reached" }));

    expect(result.content[0].text).toContain("rate_limited");
    expect(result.content[0].text).toMatch(/try again/i);
  });

  it("caps a serialized tool response", async () => {
    const result = await runMcpTool({
      env: env(),
      toolName: "read_article",
      requestId: "request-1",
      requiredScope: "content:read",
      limiter: "general",
    }, async () => ({ body: "x".repeat(RESPONSE_MAX_CHARS + 1) }));

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(RESPONSE_MAX_CHARS);
    expect(result.isError).toBe(true);
  });

  it("rejects an individual textual response body over the body limit", async () => {
    const result = await runMcpTool({
      env: env(),
      toolName: "read_article",
      requestId: "request-1",
      requiredScope: "content:read",
      limiter: "general",
    }, async () => ({
      content: [{ type: "text", text: "x".repeat(BODY_MAX_CHARS + 1) }],
    }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("internal_error");
  });

  it("does not log attacker-controlled properties from unexpected failures", async () => {
    const attackerControlledName = "attacker-controlled-log-content";

    await runMcpTool({
      env: env(),
      toolName: "read_article",
      requestId: "request-1",
      requiredScope: "content:read",
      limiter: "general",
    }, async () => Promise.reject({ constructor: { name: attackerControlledName } }));

    const serialized = JSON.stringify(consoleError.mock.calls);
    expect(serialized).not.toContain(attackerControlledName);
    expect(JSON.parse(consoleError.mock.calls[0][0])).toMatchObject({
      errorClass: "unexpected_error",
    });
  });

  it("logs metadata without arguments or content", async () => {
    await runMcpTool({
      env: env(),
      toolName: "read_article",
      requestId: "request-1",
      requiredScope: "content:read",
      limiter: "general",
    }, async () => ({ secretText: "private project body" }));

    const serialized = JSON.stringify(consoleInfo.mock.calls);
    expect(serialized).toContain("request-1");
    expect(serialized).not.toContain("private project body");
    expect(serialized).not.toContain("user-a");
  });

  it("builds an exact OAuth bearer challenge", () => {
    expect(oauthChallenge(env(), ["content:read"], "insufficient_scope")).toBe(
      'Bearer resource_metadata="https://vibegarden.example/.well-known/oauth-protected-resource", scope="content:read", error="insufficient_scope"',
    );
  });

  it("throws a public scope error for a missing scope", () => {
    expect(() => requireScope({ userId: "user-a", clubId: "club-a", scopes: [] }, "content:read"))
      .toThrow(/required scope is missing/i);
  });
});
