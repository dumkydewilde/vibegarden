import { describe, expect, it, vi } from "vitest";

const requireUser = vi.hoisted(() => vi.fn());
const hashMcpUser = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth.server", () => ({ requireUser }));
vi.mock("~/lib/mcp/auth.server", () => ({ hashMcpUser }));

import { action, loader } from "../settings.connections";

function args(request: Request, env: Env) {
  return { request, context: { get: () => ({ env, ctx: {} }) } } as never;
}

describe("MCP connections", () => {
  it("lists only the signed-in user's grants", async () => {
    const provider = {
      listUserGrants: vi.fn().mockResolvedValue({
        items: [{
          id: "grant-a",
          metadata: { clientName: "Garden Reader", grantedScopes: ["projects:read"] },
          createdAt: 1,
          expiresAt: 2,
          token: "must-not-leak",
        }],
        cursor: undefined,
      }),
    };
    requireUser.mockResolvedValue({ id: "user-a" });

    const result = await loader(args(new Request("https://garden.test/settings/connections"), {
      OAUTH_PROVIDER: provider,
    } as unknown as Env));

    expect(provider.listUserGrants).toHaveBeenCalledWith("user-a", { limit: 100 });
    expect(result).toEqual({
      grants: [{
        id: "grant-a",
        clientLabel: "Garden Reader",
        scopes: ["projects:read"],
        createdAt: 1,
        expiresAt: 2,
      }],
    });
  });

  it("revokes a grant owned by the signed-in user with a same-origin POST", async () => {
    const provider = { revokeGrant: vi.fn() };
    requireUser.mockResolvedValue({ id: "user-a" });
    hashMcpUser.mockResolvedValue("user-hash");
    const form = new FormData();
    form.set("grant_id", "grant-a");

    const response = await action(args(new Request("https://garden.test/settings/connections", {
      method: "POST",
      headers: { Origin: "https://garden.test" },
      body: form,
    }), { OAUTH_PROVIDER: provider, SESSION_SECRET: "secret" } as unknown as Env));

    expect(provider.revokeGrant).toHaveBeenCalledWith("grant-a", "user-a");
    expect(response.headers.get("Location")).toBe("/settings/connections");
  });

  it("rejects a cross-origin revocation request", async () => {
    const provider = { revokeGrant: vi.fn() };
    await expect(action(args(new Request("https://garden.test/settings/connections", {
      method: "POST",
      headers: { Origin: "https://evil.test" },
      body: new FormData(),
    }), { OAUTH_PROVIDER: provider } as unknown as Env))).rejects.toMatchObject({ status: 403 });
    expect(provider.revokeGrant).not.toHaveBeenCalled();
  });
});
