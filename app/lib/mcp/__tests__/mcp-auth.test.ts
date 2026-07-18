import { describe, expect, it } from "vitest";
import { hashMcpUser } from "~/lib/mcp/auth.server";

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
});
