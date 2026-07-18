import { render, screen } from "@testing-library/react";
import { createRoutesStub, redirect } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Consent, { action, loader } from "../oauth.authorize";

const getUser = vi.hoisted(() => vi.fn());
const hashMcpUser = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth.server", () => ({ getUser }));
vi.mock("~/lib/mcp/auth.server", () => ({ hashMcpUser }));

const oauthRequest = {
  responseType: "code",
  clientId: "test-client",
  redirectUri: "https://client.example/callback",
  scope: ["projects:read", "content:read", "admin:write"],
  state: "client-state",
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
    getUser.mockResolvedValue({ id: "user-1" });
    const data = await loader(
      args(new Request("https://vibegarden.test/authorize?client_id=test-client"), {
        OAUTH_PROVIDER: provider,
      } as unknown as Env),
    );

    expect(data).toEqual({
      clientName: "Garden Reader",
      redirectUri: "https://client.example/callback",
      requestedScopes: ["projects:read", "content:read"],
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
  });

  it("completes consent with only requested supported submitted scopes", async () => {
    const provider = oauthProvider();
    getUser.mockResolvedValue({ id: "user-1" });
    hashMcpUser.mockResolvedValue("safe-user-hash");
    const form = new FormData();
    form.append("scope", "projects:read");
    form.append("scope", "admin:write");

    const response = await action(
      args(
        new Request("https://vibegarden.test/authorize?client_id=test-client", {
          method: "POST",
          headers: { Origin: "https://vibegarden.test" },
          body: form,
        }),
        { OAUTH_PROVIDER: provider } as unknown as Env,
      ),
    );

    expect(provider.completeAuthorization).toHaveBeenCalledWith({
      request: oauthRequest,
      userId: "user-1",
      metadata: {
        clientName: "Garden Reader",
        grantedScopes: ["projects:read"],
      },
      scope: ["projects:read"],
      props: { userId: "user-1", scopes: ["projects:read"] },
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe(
      "https://client.example/callback?code=abc",
    );
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
});
