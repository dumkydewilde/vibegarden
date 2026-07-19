import { describe, expect, it, vi } from "vitest";

const requireUser = vi.hoisted(() => vi.fn());
const hashMcpUser = vi.hoisted(() => vi.fn());
const requireClubContext = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth.server", () => ({ requireUser }));
vi.mock("~/lib/mcp/auth.server", () => ({ hashMcpUser }));
vi.mock("~/lib/clubs.server", () => ({ requireClubContext }));

import { action, loader } from "../settings.connections";

function args(request: Request, env: Env) {
  return {
    request,
    params: { clubSlug: "wotf" },
    context: { get: () => ({ env, ctx: {} }) },
  } as never;
}

describe("MCP connections", () => {
  const clubContext = {
    club: { id: "club-a", name: "WOTF Club", slug: "wotf", status: "active" },
  };

  it.each(["GET", "PUT", "DELETE"])("rejects %s revocation requests", async (method) => {
    const provider = { revokeGrant: vi.fn() };
    requireClubContext.mockResolvedValue(clubContext);

    await expect(action(args(new Request("https://garden.test/settings/connections", { method }), {
      OAUTH_PROVIDER: provider,
    } as unknown as Env))).rejects.toMatchObject({ status: 405 });
    expect(provider.revokeGrant).not.toHaveBeenCalled();
  });

  it("lists only the signed-in user's grants", async () => {
    const provider = {
      listUserGrants: vi.fn().mockResolvedValue({
        items: [{
          id: "grant-a",
          metadata: {
            clientName: "Garden Reader",
            grantedScopes: ["projects:read"],
            clubId: "club-a",
            clubName: "WOTF Club",
          },
          createdAt: 1,
          expiresAt: 2,
          token: "must-not-leak",
        }],
        cursor: undefined,
      }),
    };
    requireUser.mockResolvedValue({ id: "user-a" });
    requireClubContext.mockResolvedValue(clubContext);

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
        clubName: "WOTF Club",
      }],
      club: clubContext.club,
    });
  });

  it("revokes a grant owned by the signed-in user with a same-origin POST", async () => {
    const provider = {
      listUserGrants: vi.fn().mockResolvedValue({
        items: [{ id: "grant-a", metadata: { clubId: "club-a" } }],
      }),
      revokeGrant: vi.fn(),
    };
    requireUser.mockResolvedValue({ id: "user-a" });
    requireClubContext.mockResolvedValue(clubContext);
    hashMcpUser.mockResolvedValue("user-hash");
    const form = new FormData();
    form.set("grant_id", "grant-a");

    const response = await action(args(new Request("https://garden.test/settings/connections", {
      method: "POST",
      headers: { Origin: "https://garden.test" },
      body: form,
    }), { OAUTH_PROVIDER: provider, SESSION_SECRET: "secret" } as unknown as Env));

    expect(provider.revokeGrant).toHaveBeenCalledWith("grant-a", "user-a");
    expect(response.headers.get("Location")).toBe("/clubs/wotf/settings/connections");
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
