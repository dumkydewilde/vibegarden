import { render, screen } from "@testing-library/react";
import { createRoutesStub, redirect } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Consent, { action, loader } from "../oauth.authorize";

const getUser = vi.hoisted(() => vi.fn());
const hashMcpUser = vi.hoisted(() => vi.fn());
const listUserClubs = vi.hoisted(() => vi.fn());
const listActiveClubs = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth.server", () => ({ getUser }));
vi.mock("~/lib/mcp/auth.server", () => ({ hashMcpUser }));
vi.mock("~/lib/clubs.server", () => ({ listUserClubs, listActiveClubs }));

const club = {
  id: "club-1",
  name: "WOTF Club",
  slug: "wotf",
  status: "active" as const,
};

function grantClubAccess() {
  listUserClubs.mockResolvedValue([{
    club,
    membership: { clubId: club.id, userId: "user-1", role: "member" },
  }]);
}

const oauthRequest = {
  responseType: "code",
  clientId: "test-client",
  redirectUri: "https://client.example/callback",
  scope: ["projects:read", "content:read", "admin:write"],
  state: "client-state",
  resource: "https://vibegarden.test/mcp",
};

function args(request: Request, env: Env) {
  return {
    request,
    context: { get: () => ({ env, ctx: {} }) },
  } as never;
}

function oauthProvider() {
  return {
    parseAuthRequest: vi.fn().mockResolvedValue(oauthRequest),
    lookupClient: vi.fn().mockResolvedValue({
      clientId: "test-client",
      clientName: "Garden Reader",
      redirectUris: ["https://client.example/callback"],
      tokenEndpointAuthMethod: "none",
    }),
    completeAuthorization: vi
      .fn()
      .mockResolvedValue({ redirectTo: "https://client.example/callback?code=abc" }),
  };
}

describe("OAuth authorization consent", () => {
  it("displays the client and requested supported scopes", async () => {
    const provider = oauthProvider();
    getUser.mockResolvedValue({ id: "user-1", lastClubId: "club-1", platformRole: "user" });
    grantClubAccess();
    const data = await loader(
      args(new Request("https://vibegarden.test/authorize?client_id=test-client"), {
        MCP_RESOURCE_URL: "https://vibegarden.test/mcp",
        OAUTH_PROVIDER: provider,
      } as unknown as Env),
    );

    expect(data).toEqual({
      clientName: "Garden Reader",
      redirectUri: "https://client.example/callback",
      requestedScopes: ["projects:read", "content:read"],
      clubs: [club],
      selectedClubId: "club-1",
    });

    const Stub = createRoutesStub([
      {
        path: "/authorize",
        Component: Consent,
        HydrateFallback: () => null,
        loader: () => data,
        action: () => ({ ok: true }),
      },
    ]);
    render(<Stub initialEntries={["/authorize"]} />);
    expect(await screen.findByText(/connect garden reader/i)).toBeInTheDocument();
    expect(screen.getByText("client.example")).toBeInTheDocument();
    expect(screen.getByText(/view your garden projects/i)).toBeInTheDocument();
    expect(screen.getByText(/read your learning content/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "WOTF Club" })).toBeInTheDocument();
  });

  it("completes consent with only requested supported submitted scopes", async () => {
    const provider = oauthProvider();
    getUser.mockResolvedValue({ id: "user-1", platformRole: "user" });
    grantClubAccess();
    hashMcpUser.mockResolvedValue("safe-user-hash");
    const form = new FormData();
    form.append("scope", "projects:read");
    form.append("scope", "admin:write");
    form.set("club_id", "club-1");

    const response = await action(
      args(
        new Request("https://vibegarden.test/authorize?client_id=test-client", {
          method: "POST",
          headers: { Origin: "https://vibegarden.test" },
          body: form,
        }),
        {
          MCP_RESOURCE_URL: "https://vibegarden.test/mcp",
          OAUTH_PROVIDER: provider,
        } as unknown as Env,
      ),
    );

    expect(provider.completeAuthorization).toHaveBeenCalledWith({
      request: oauthRequest,
      userId: "user-1",
      metadata: {
        clientName: "Garden Reader",
        grantedScopes: ["projects:read"],
        clubId: "club-1",
        clubName: "WOTF Club",
        clubSlug: "wotf",
      },
      scope: ["projects:read"],
      props: { userId: "user-1", clubId: "club-1", scopes: ["projects:read"] },
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe(
      "https://client.example/callback?code=abc",
    );
  });

  it("rejects a submitted club outside the signed-in user's memberships", async () => {
    const provider = oauthProvider();
    getUser.mockResolvedValue({ id: "user-1", platformRole: "user" });
    grantClubAccess();
    const form = new FormData();
    form.set("scope", "projects:read");
    form.set("club_id", "foreign-club");

    await expect(action(args(new Request(
      "https://vibegarden.test/authorize?client_id=test-client",
      { method: "POST", headers: { Origin: "https://vibegarden.test" }, body: form },
    ), {
      MCP_RESOURCE_URL: "https://vibegarden.test/mcp",
      OAUTH_PROVIDER: provider,
    } as unknown as Env))).rejects.toMatchObject({ status: 404 });
    expect(provider.completeAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a foreign consent POST before completing authorization", async () => {
    const provider = oauthProvider();
    const form = new FormData();
    form.append("scope", "projects:read");

    await expect(
      action(
        args(
          new Request("https://vibegarden.test/authorize?client_id=test-client", {
            method: "POST",
            headers: { Origin: "https://evil.example" },
            body: form,
          }),
          { OAUTH_PROVIDER: provider } as unknown as Env,
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(provider.completeAuthorization).not.toHaveBeenCalled();
  });

  it("returns unauthenticated visitors to login with the internal authorization path", async () => {
    getUser.mockResolvedValue(null);
    const provider = oauthProvider();
    const request = new Request(
      "https://vibegarden.test/authorize?client_id=test-client&state=xyz",
    );

    await expect(
      loader(args(request, { OAUTH_PROVIDER: provider } as unknown as Env)),
    ).rejects.toEqual(
      redirect("/login?next=%2Fauthorize%3Fclient_id%3Dtest-client%26state%3Dxyz"),
    );
  });

  it("rejects authorization requests for a resource other than MCP", async () => {
    const provider = oauthProvider();
    provider.parseAuthRequest.mockResolvedValue({
      ...oauthRequest,
      resource: "https://evil.example/mcp",
    });
    getUser.mockResolvedValue({ id: "user-1", platformRole: "user" });
    grantClubAccess();

    await expect(
      loader(args(new Request("https://vibegarden.test/authorize?client_id=test-client"), {
        APP_ORIGIN: "https://vibegarden.test",
        MCP_RESOURCE_URL: "https://vibegarden.test/mcp",
        OAUTH_PROVIDER: provider,
      } as unknown as Env)),
    ).rejects.toMatchObject({ status: 400 });
  });
});
