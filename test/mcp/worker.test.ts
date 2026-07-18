import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://vibegarden.test";
const REDIRECT_URI = "http://127.0.0.1:54321/callback";

function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function registerClient(redirectUri = REDIRECT_URI) {
  const response = await SELF.fetch(`${ORIGIN}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
  });
  return { response, body: await response.json() as { client_id: string } };
}

async function authorizeWithPkce(
  clientId: string,
  scopes = "projects:read content:read",
  resource = `${ORIGIN}/mcp`,
  userId = "oauth-user",
) {
  const verifier = "a-very-long-pkce-verifier-that-is-only-used-by-the-worker-integration-test";
  const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: scopes,
    resource,
    state: "test-state",
  });
  const response = await SELF.fetch(`${ORIGIN}/authorize?${query}`, {
    headers: { "x-test-user-id": userId },
    redirect: "manual",
  });
  const redirect = response.headers.get("location");
  return { response, code: redirect ? new URL(redirect).searchParams.get("code") : null, verifier };
}

async function exchangeCode(clientId: string, code: string, verifier: string) {
  const response = await SELF.fetch(`${ORIGIN}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      resource: `${ORIGIN}/mcp`,
    }),
  });
  return { response, body: await response.json() as { access_token: string; refresh_token: string } };
}

async function mcpRpc(token: string, method: string, params: Record<string, unknown> = {}) {
  return SELF.fetch(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
  });
}

async function mcpJson(response: Response) {
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(data?.slice(6) ?? text) as Record<string, unknown>;
}

async function refreshToken(clientId: string, refreshToken: string) {
  const response = await SELF.fetch(`${ORIGIN}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      resource: `${ORIGIN}/mcp`,
    }),
  });
  return { response, body: await response.json() as { access_token: string; refresh_token: string } };
}

describe("Gardener MCP Worker", () => {
  it("challenges unauthenticated MCP requests without breaking the website", async () => {
    const mcp = await SELF.fetch("https://vibegarden.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("WWW-Authenticate")).toContain("resource_metadata=");

    const page = await SELF.fetch("https://vibegarden.test/connect");
    expect(page.status).not.toBe(401);
  });

  it("publishes exact protected-resource and authorization metadata", async () => {
    const resource = await SELF.fetch("https://vibegarden.test/.well-known/oauth-protected-resource");
    await expect(resource.json()).resolves.toMatchObject({
      resource: "https://vibegarden.test/mcp",
      authorization_servers: ["https://vibegarden.test"],
      scopes_supported: ["projects:read", "content:read"],
    });
    const authorization = await SELF.fetch("https://vibegarden.test/.well-known/oauth-authorization-server");
    await expect(authorization.json()).resolves.toMatchObject({
      registration_endpoint: "https://vibegarden.test/register",
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("runs DCR and the S256 PKCE authorization-code flow", async () => {
    const client = await registerClient();
    expect(client.response.status).toBe(201);

    const grant = await authorizeWithPkce(client.body.client_id);
    expect(grant.response.status).toBe(302);
    expect(grant.code).toEqual(expect.any(String));

    const token = await exchangeCode(client.body.client_id, grant.code!, grant.verifier);
    expect(token.response.status).toBe(200);
    expect(token.body.access_token).toEqual(expect.any(String));

    const initialize = await mcpRpc(token.body.access_token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "worker-test", version: "1.0.0" },
    });
    expect(initialize.status).toBe(200);

    const tools = await mcpRpc(token.body.access_token, "tools/list");
    expect(tools.status).toBe(200);
    await expect(mcpJson(tools)).resolves.toMatchObject({
      result: { tools: expect.arrayContaining([expect.objectContaining({ name: "list_projects" })]) },
    });
  });

  it("rotates refresh tokens and invalidates a revoked grant", async () => {
    const client = await registerClient();
    const grant = await authorizeWithPkce(client.body.client_id, undefined, undefined, "revoke-user");
    const initial = await exchangeCode(client.body.client_id, grant.code!, grant.verifier);
    const refreshed = await refreshToken(client.body.client_id, initial.body.refresh_token);
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(initial.body.refresh_token);

    const revoke = await SELF.fetch(`${ORIGIN}/test/revoke`, {
      headers: { "x-test-user-id": "revoke-user" },
    });
    expect(revoke.status).toBe(204);
    expect((await mcpRpc(refreshed.body.access_token, "tools/list")).status).toBe(401);
  });

  it("returns a public invalid-input result and a 403 scope challenge before tool execution", async () => {
    const client = await registerClient();
    const grant = await authorizeWithPkce(client.body.client_id, "projects:read");
    const token = await exchangeCode(client.body.client_id, grant.code!, grant.verifier);

    const invalid = await mcpRpc(token.body.access_token, "tools/call", {
      name: "get_project",
      arguments: { project_id: "x", extra: "nope" },
    });
    expect(invalid.status).toBe(200);
    await expect(invalid.json()).resolves.toMatchObject({
      result: { isError: true, content: [expect.objectContaining({ text: expect.stringContaining("invalid_input") })] },
    });

    const insufficient = await mcpRpc(token.body.access_token, "tools/call", {
      name: "read_article",
      arguments: { slug: "anything" },
    });
    expect(insufficient.status).toBe(403);
    expect(insufficient.headers.get("WWW-Authenticate")).toContain("insufficient_scope");
    await expect(insufficient.json()).resolves.toMatchObject({
      id: 7,
      result: { _meta: { "mcp/www_authenticate": expect.any(Array) } },
    });
  });

  it("rejects unsupported DCR redirects and an authorization request for another resource", async () => {
    const rejected = await registerClient("https://evil.example/callback");
    expect(rejected.response.status).toBe(400);
    expect(rejected.body).toMatchObject({ error: "invalid_redirect_uri" });

    const client = await registerClient();
    const grant = await authorizeWithPkce(client.body.client_id, "projects:read", "https://evil.example/mcp");
    expect(grant.response.status).toBe(400);
  });
});
