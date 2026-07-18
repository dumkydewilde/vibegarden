import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
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
  clubId = "test-club",
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
    headers: { "x-test-user-id": userId, "x-test-club-id": clubId },
    redirect: "manual",
  });
  const redirect = response.headers.get("location");
  return { response, code: redirect ? new URL(redirect).searchParams.get("code") : null, verifier };
}

async function exchangeCode(
  clientId: string,
  code: string,
  verifier: string,
  accessTokenTtl?: 1,
) {
  const response = await SELF.fetch(`${ORIGIN}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(accessTokenTtl ? { "x-test-access-token-ttl": String(accessTokenTtl) } : {}),
    },
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

async function accessTokenFor(
  userId: string,
  scopes = "projects:read content:read",
  clubId = "test-club",
) {
  const client = await registerClient();
  const grant = await authorizeWithPkce(
    client.body.client_id,
    scopes,
    undefined,
    userId,
    clubId,
  );
  const token = await exchangeCode(client.body.client_id, grant.code!, grant.verifier);
  return token.body.access_token;
}

async function waitUntilFinalTenthOfSecond() {
  const remaining = Date.now() % 1_000;
  if (remaining < 900) await new Promise((resolve) => setTimeout(resolve, 900 - remaining));
}

function expectPrivateNotFound(body: Record<string, unknown>, secrets: string[]) {
  const serialized = JSON.stringify(body);
  expect(serialized).toContain("not_found");
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

async function seedPrivateRecords() {
  const suffix = crypto.randomUUID();
  const owner = `owner-${suffix}`;
  const attacker = `attacker-${suffix}`;
  const ownerClub = `owner-club-${suffix}`;
  const attackerClub = `attacker-club-${suffix}`;
  const projectId = `private-project-${suffix}`;
  const conversationId = `private-conversation-${suffix}`;
  const projectTitle = `Owner secret project ${suffix}`;
  const messageBody = `Owner secret message ${suffix}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name, role, stage, created_at) VALUES (?, ?, ?, 'user', 'exploring', ?)")
      .bind(owner, `${owner}@example.test`, "Owner", now),
    env.DB.prepare("INSERT INTO users (id, email, name, role, stage, created_at) VALUES (?, ?, ?, 'user', 'exploring', ?)")
      .bind(attacker, `${attacker}@example.test`, "Attacker", now),
    env.DB.prepare("INSERT INTO clubs (id, name, slug, model_policy, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'all_models', 'active', ?, ?, ?)")
      .bind(ownerClub, "Owner Club", ownerClub, owner, now, now),
    env.DB.prepare("INSERT INTO clubs (id, name, slug, model_policy, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'all_models', 'active', ?, ?, ?)")
      .bind(attackerClub, "Attacker Club", attackerClub, attacker, now, now),
    env.DB.prepare("INSERT INTO club_memberships (club_id, user_id, role, onboarding_stage, joined_at, updated_at) VALUES (?, ?, 'owner', 'exploring', ?, ?)")
      .bind(ownerClub, owner, now, now),
    env.DB.prepare("INSERT INTO club_memberships (club_id, user_id, role, onboarding_stage, joined_at, updated_at) VALUES (?, ?, 'owner', 'exploring', ?, ?)")
      .bind(attackerClub, attacker, now, now),
    env.DB.prepare("INSERT INTO chat_threads (id, user_id, club_id, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(conversationId, owner, ownerClub, `Owner private thread ${suffix}`, projectId, now, now),
    env.DB.prepare("INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)")
      .bind(`message-${suffix}`, conversationId, messageBody, now),
    env.DB.prepare("INSERT INTO projects (id, user_id, club_id, title, one_liner, modules, status, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', 'seed', ?, ?, ?)")
      .bind(projectId, owner, ownerClub, projectTitle, messageBody, conversationId, now, now),
  ]);
  return {
    owner,
    ownerClub,
    attacker,
    attackerClub,
    projectId,
    conversationId,
    projectTitle,
    messageBody,
  };
}

async function seedOwnedProject(userId: string, clubId = "test-club") {
  const suffix = crypto.randomUUID();
  const projectId = `owned-project-${suffix}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id, email, name, role, stage, created_at) VALUES (?, ?, ?, 'user', 'exploring', ?)")
      .bind(userId, `${userId}@example.test`, "OAuth user", now),
    env.DB.prepare("INSERT OR IGNORE INTO clubs (id, name, slug, model_policy, status, created_by, created_at, updated_at) VALUES (?, 'Test Club', ?, 'all_models', 'active', ?, ?, ?)")
      .bind(clubId, clubId, userId, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO club_memberships (club_id, user_id, role, onboarding_stage, joined_at, updated_at) VALUES (?, ?, 'member', 'exploring', ?, ?)")
      .bind(clubId, userId, now, now),
    env.DB.prepare(
      "INSERT INTO projects (id, user_id, club_id, title, one_liner, modules, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', 'seed', ?, ?)",
    ).bind(projectId, userId, clubId, `Owned project ${suffix}`, "A project owned by the OAuth user.", now, now),
  ]);
  return projectId;
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

    const malformed = await mcpRpc("not-a-real-access-token", "tools/list");
    expect(malformed.status).toBe(401);
  });

  it("publishes exact protected-resource and authorization metadata", async () => {
    const resource = await SELF.fetch("https://vibegarden.test/.well-known/oauth-protected-resource");
    const resourceMetadata = await resource.json() as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(resourceMetadata).toMatchObject({
      resource: "https://vibegarden.test/mcp",
      authorization_servers: ["https://vibegarden.test"],
    });
    expect(resourceMetadata.scopes_supported).toEqual(["projects:read", "content:read"]);
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

    const contentOnlyToken = await accessTokenFor("content-only-user", "content:read");
    const tools = await mcpRpc(contentOnlyToken, "tools/list");
    expect(tools.status).toBe(200);
    const toolList = await mcpJson(tools);
    expect(toolList).toMatchObject({
      result: { tools: expect.arrayContaining([expect.objectContaining({ name: "list_projects" })]) },
    });
    expect(JSON.stringify(toolList)).toContain("list_learning_content");
    expect(JSON.stringify(toolList)).not.toContain("fresh_reads");

    const content = await mcpRpc(contentOnlyToken, "tools/call", {
      name: "list_learning_content",
      arguments: {},
    });
    expect(content.status).toBe(200);
    await expect(mcpJson(content)).resolves.toMatchObject({
      result: { structuredContent: { items: expect.any(Array) } },
    });

    const resources = await mcpRpc(token.body.access_token, "resources/templates/list");
    await expect(mcpJson(resources)).resolves.toMatchObject({
      result: { resourceTemplates: expect.arrayContaining([expect.objectContaining({ uriTemplate: "vibegarden://project/{id}" })]) },
    });
    const prompts = await mcpRpc(token.body.access_token, "prompts/list");
    await expect(mcpJson(prompts)).resolves.toMatchObject({
      result: { prompts: expect.arrayContaining([expect.objectContaining({ name: "continue_project" })]) },
    });

    const projectId = await seedOwnedProject("oauth-user");
    const prompt = await mcpRpc(token.body.access_token, "prompts/get", {
      name: "continue_project",
      arguments: { project_id: projectId },
    });
    expect(prompt.status).toBe(200);
    await expect(mcpJson(prompt)).resolves.toMatchObject({
      result: { messages: expect.any(Array) },
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

  it("rejects a real one-second OAuth access token after it expires", async () => {
    const client = await registerClient();
    const grant = await authorizeWithPkce(client.body.client_id, "projects:read");
    await waitUntilFinalTenthOfSecond();
    const token = await exchangeCode(client.body.client_id, grant.code!, grant.verifier, 1);
    expect(token.response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect((await mcpRpc(token.body.access_token, "tools/list")).status).toBe(401);
  });

  it("does not disclose another user's private D1 project or conversation over MCP", async () => {
    const privateRecords = await seedPrivateRecords();
    const token = await accessTokenFor(
      privateRecords.attacker,
      undefined,
      privateRecords.attackerClub,
    );
    const secrets = [privateRecords.projectTitle, privateRecords.messageBody];

    const calls: Array<[string, Record<string, unknown>]> = [
      ["tools/call", { name: "get_project", arguments: { project_id: privateRecords.projectId } }],
      ["tools/call", { name: "get_conversation", arguments: { conversation_id: privateRecords.conversationId } }],
      ["tools/call", { name: "fetch", arguments: { id: `project:${privateRecords.projectId}` } }],
      ["resources/read", { uri: `vibegarden://project/${privateRecords.projectId}` }],
      ["resources/read", { uri: `vibegarden://conversation/${privateRecords.conversationId}` }],
    ];
    for (const [method, params] of calls) {
      const response = await mcpRpc(token, method, params);
      expect(response.status).toBe(200);
      expectPrivateNotFound(await mcpJson(response), secrets);
    }

    const search = await mcpRpc(token, "tools/call", {
      name: "search",
      arguments: { query: privateRecords.projectTitle },
    });
    expect(search.status).toBe(200);
    const searchBody = await mcpJson(search);
    const searchResult = searchBody.result as {
      structuredContent?: unknown;
      content?: unknown;
    };
    expect(searchResult.structuredContent).toEqual({ results: [] });
    expect(searchResult.content).toEqual([{ type: "text", text: JSON.stringify({ results: [] }) }]);
    expect(JSON.stringify(searchBody)).not.toContain(privateRecords.projectTitle);
    expect(JSON.stringify(searchBody)).not.toContain(privateRecords.messageBody);
    expectPrivateNotFound(await mcpJson(await mcpRpc(token, "tools/call", {
      name: "fetch",
      arguments: { id: `conversation:${privateRecords.conversationId}` },
    })), secrets);
  });

  it("returns an owned private project resource through the HTTP MCP transport", async () => {
    const privateRecords = await seedPrivateRecords();
    const token = await accessTokenFor(
      privateRecords.owner,
      undefined,
      privateRecords.ownerClub,
    );

    const response = await mcpRpc(token, "resources/read", {
      uri: `vibegarden://project/${privateRecords.projectId}`,
    });

    expect(response.status).toBe(200);
    const body = await mcpJson(response);
    expect(body).toMatchObject({
      result: {
        contents: [expect.objectContaining({
          uri: `vibegarden://project/${privateRecords.projectId}`,
          mimeType: "application/json",
        })],
      },
    });
    const text = ((body.result as { contents: Array<{ text: string }> }).contents[0]).text;
    expect(JSON.parse(text)).toMatchObject({
      id: privateRecords.projectId,
      title: privateRecords.projectTitle,
      one_liner: privateRecords.messageBody,
    });
  });

  it("keeps concurrent OAuth MCP requests isolated by their request props", async () => {
    const firstUser = `concurrent-first-${crypto.randomUUID()}`;
    const secondUser = `concurrent-second-${crypto.randomUUID()}`;
    const [firstProject, secondProject] = await Promise.all([
      seedOwnedProject(firstUser),
      seedOwnedProject(secondUser),
    ]);
    const [firstToken, secondToken] = await Promise.all([
      accessTokenFor(firstUser, "projects:read"),
      accessTokenFor(secondUser, "projects:read"),
    ]);

    const [firstResponse, secondResponse] = await Promise.all([
      mcpRpc(firstToken, "prompts/get", { name: "continue_project", arguments: { project_id: firstProject } }),
      mcpRpc(secondToken, "prompts/get", { name: "continue_project", arguments: { project_id: secondProject } }),
    ]);
    const [firstBody, secondBody] = await Promise.all([mcpJson(firstResponse), mcpJson(secondResponse)]);
    expect(JSON.stringify(firstBody)).toContain(firstProject);
    expect(JSON.stringify(firstBody)).not.toContain(secondProject);
    expect(JSON.stringify(secondBody)).toContain(secondProject);
    expect(JSON.stringify(secondBody)).not.toContain(firstProject);
  });

  it("enforces general and history limits through real MCP HTTP requests", async () => {
    const token = await accessTokenFor(`limit-${crypto.randomUUID()}`);
    let general: Response | undefined;
    for (let count = 0; count <= 60; count++) {
      general = await mcpRpc(token, "tools/call", { name: "list_projects", arguments: {} });
      expect(general.status).toBe(200);
    }
    expect(JSON.stringify(await mcpJson(general!))).toContain("rate_limited");

    let history: Response | undefined;
    for (let count = 0; count <= 12; count++) {
      history = await mcpRpc(token, "tools/call", {
        name: "get_conversation",
        arguments: { conversation_id: "missing-history-conversation" },
      });
      expect(history.status).toBe(200);
    }
    expect(JSON.stringify(await mcpJson(history!))).toContain("rate_limited");
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

    for (const argumentsValue of [undefined, { project_id: "x".repeat(201) }]) {
      const malformed = await mcpRpc(token.body.access_token, "tools/call", {
        name: "get_project",
        ...(argumentsValue === undefined ? {} : { arguments: argumentsValue }),
      });
      expect(malformed.status).toBe(200);
      await expect(mcpJson(malformed)).resolves.toMatchObject({
        result: { isError: true, content: [expect.objectContaining({ text: expect.stringContaining("invalid_input") })] },
      });
    }

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

  it("rejects a disallowed Origin at the outer MCP boundary, including preflight", async () => {
    const options = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(options.status).toBe(403);
    expect(options.headers.get("Access-Control-Allow-Origin")).not.toBe("https://evil.example");

    const post = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(post.status).toBe(403);
  });

  it("routes only the exact MCP endpoint through OAuth and permits origin-less OAuth MCP calls", async () => {
    const nested = await SELF.fetch(`${ORIGIN}/mcp/not-an-mcp-endpoint`);
    expect(nested.status).toBe(404);
    expect(nested.headers.get("WWW-Authenticate")).toBeNull();
    const prefixOnly = await SELF.fetch(`${ORIGIN}/mcp-not-an-endpoint`);
    expect(prefixOnly.status).toBe(404);
    expect(prefixOnly.headers.get("WWW-Authenticate")).toBeNull();

    const client = await registerClient();
    const grant = await authorizeWithPkce(client.body.client_id, "projects:read");
    const token = await exchangeCode(client.body.client_id, grant.code!, grant.verifier);
    const response = await mcpRpc(token.body.access_token, "prompts/get", {
      name: "continue_project",
      arguments: {},
    });
    expect(response.status).toBe(200);
  });

  it("preflights malformed prompts/get arguments with a stable public invalid-input result", async () => {
    const client = await registerClient();
    const grant = await authorizeWithPkce(client.body.client_id, "projects:read");
    const token = await exchangeCode(client.body.client_id, grant.code!, grant.verifier);
    const response = await mcpRpc(token.body.access_token, "prompts/get", {
      name: "continue_project",
      arguments: { project_id: 123, unexpected: "nope" },
    });
    expect(response.status).toBe(200);
    await expect(mcpJson(response)).resolves.toMatchObject({
      id: 7,
      result: { isError: true, content: [expect.objectContaining({ text: expect.stringContaining("invalid_input") })] },
    });
  });
});
