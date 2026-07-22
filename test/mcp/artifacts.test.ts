import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://vibegarden.test";
const REDIRECT_URI = "http://127.0.0.1:54321/callback";

function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function oauthGrantFor(userId: string, clubId: string, scopes = "artifacts:write artifacts:publish") {
  const registration = await SELF.fetch(`${ORIGIN}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" }),
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = await registration.json() as { client_id: string };

  const verifier = "a-long-pkce-verifier-used-only-for-real-mcp-artifact-tests";
  const codeChallenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const authorization = await SELF.fetch(`${ORIGIN}/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: scopes,
    resource: `${ORIGIN}/mcp`,
    state: "artifact-test-state",
  })}`, {
    headers: { "x-test-user-id": userId, "x-test-club-id": clubId },
    redirect: "manual",
  });
  expect(authorization.status).toBe(302);
  const code = new URL(authorization.headers.get("location")!).searchParams.get("code");
  expect(code).toEqual(expect.any(String));

  const token = await SELF.fetch(`${ORIGIN}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code!,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      resource: `${ORIGIN}/mcp`,
    }),
  });
  expect(token.status).toBe(200);
  return { accessToken: (await token.json() as { access_token: string }).access_token, clientId, code: code! };
}

async function accessTokenFor(userId: string, clubId: string, scopes = "artifacts:write artifacts:publish") {
  return (await oauthGrantFor(userId, clubId, scopes)).accessToken;
}

async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
  const response = await SELF.fetch(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return { response, body: JSON.parse(data?.slice(6) ?? text) as Record<string, unknown> };
}

type Mutation = { artifact_id: string; version_id: string; visibility: "private" | "gallery"; url: string };

function mutation(body: Record<string, unknown>): Mutation {
  return ((body.result as { structuredContent: Mutation }).structuredContent);
}

function serialized(body: Record<string, unknown>) {
  return JSON.stringify(body);
}

function artifactInput(projectId: string, idempotencyKey: string, files = [
  { path: "index.html", content: "<!doctype html><link rel=\"stylesheet\" href=\"styles.css\"><main>Hello</main>" },
  { path: "styles.css", content: "main { color: rebeccapurple; }" },
]) {
  return {
    project_id: projectId,
    title: "Model-generated dashboard",
    description: "Created through MCP",
    files,
    allowed_data_origins: [],
    idempotency_key: idempotencyKey,
  };
}

async function seedTwoClubProjects() {
  const suffix = crypto.randomUUID();
  const userId = `artifact-user-${suffix}`;
  const firstClub = { id: `artifact-club-a-${suffix}`, slug: `artifact-club-a-${suffix}`, projectId: `artifact-project-a-${suffix}` };
  const secondClub = { id: `artifact-club-b-${suffix}`, slug: `artifact-club-b-${suffix}`, projectId: `artifact-project-b-${suffix}` };
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name, role, stage, created_at) VALUES (?, ?, 'Artifact user', 'user', 'exploring', ?)").bind(userId, `${userId}@example.test`, now),
    ...[firstClub, secondClub].flatMap((club) => [
      env.DB.prepare("INSERT INTO clubs (id, name, slug, model_policy, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'all_models', 'active', ?, ?, ?)").bind(club.id, `Club ${club.id}`, club.slug, userId, now, now),
      env.DB.prepare("INSERT INTO club_memberships (club_id, user_id, role, onboarding_stage, joined_at, updated_at) VALUES (?, ?, 'member', 'exploring', ?, ?)").bind(club.id, userId, now, now),
      env.DB.prepare("INSERT INTO projects (id, user_id, club_id, title, one_liner, modules, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'MCP artifact project', '[]', 'seed', ?, ?)").bind(club.projectId, userId, club.id, `Project ${club.id}`, now, now),
    ]),
  ]);
  return { userId, firstClub, secondClub };
}

describe("MCP artifact writes", () => {
  it("creates a private MCP artifact through DCR, S256 PKCE, D1, and R2", async () => {
    const seeded = await seedTwoClubProjects();
    const token = await accessTokenFor(seeded.userId, seeded.firstClub.id);
    const { response, body } = await mcpCall(token, "create_artifact", artifactInput(
      seeded.firstClub.projectId,
      "dashboard-create-v1",
    ));

    expect(response.status).toBe(200);
    const result = mutation(body);
    expect(result).toMatchObject({
      visibility: "private",
      url: `${ORIGIN}/clubs/${seeded.firstClub.slug}/artifacts/${result.artifact_id}`,
    });
    await expect(env.DB.prepare("SELECT project_id, visibility FROM artifacts WHERE id = ?").bind(result.artifact_id).first()).resolves.toEqual({ project_id: seeded.firstClub.projectId, visibility: "private" });
    await expect(env.DB.prepare("SELECT source FROM artifact_versions WHERE id = ?").bind(result.version_id).first()).resolves.toEqual({ source: "mcp" });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE user_id = ?").bind(seeded.userId).first()).resolves.toEqual({ count: 1 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE created_by = ?").bind(seeded.userId).first()).resolves.toEqual({ count: 1 });
    const prefix = `artifacts/${result.artifact_id}/versions/${result.version_id}`;
    await expect(env.ARTIFACTS.head(`${prefix}/index.html`)).resolves.not.toBeNull();
    await expect(env.ARTIFACTS.head(`${prefix}/styles.css`)).resolves.not.toBeNull();
  });

  it("retains idempotent MCP creates, creates versions, and shares the requested version", async () => {
    const seeded = await seedTwoClubProjects();
    const token = await accessTokenFor(seeded.userId, seeded.firstClub.id);
    const create = artifactInput(seeded.firstClub.projectId, "dashboard-create-v1");
    const first = mutation((await mcpCall(token, "create_artifact", create)).body);
    const retry = mutation((await mcpCall(token, "create_artifact", create)).body);
    expect(retry).toMatchObject({ artifact_id: first.artifact_id, version_id: first.version_id, visibility: "private" });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE id = ?").bind(first.artifact_id).first()).resolves.toEqual({ count: 1 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE artifact_id = ?").bind(first.artifact_id).first()).resolves.toEqual({ count: 1 });

    const conflict = await mcpCall(token, "create_artifact", artifactInput(
      seeded.firstClub.projectId,
      "dashboard-create-v1",
      [{ path: "index.html", content: "<!doctype html><main>Changed</main>" }],
    ));
    expect(conflict.response.status).toBe(200);
    expect(serialized(conflict.body)).toContain("invalid_input");
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE artifact_id = ?").bind(first.artifact_id).first()).resolves.toEqual({ count: 1 });

    const version = mutation((await mcpCall(token, "create_artifact_version", {
      artifact_id: first.artifact_id,
      files: [{ path: "index.html", content: "<!doctype html><main>Version two</main>" }],
      allowed_data_origins: [],
      idempotency_key: "dashboard-version-v2",
    })).body);
    expect(version).toMatchObject({ artifact_id: first.artifact_id, visibility: "private" });
    expect(version.version_id).not.toBe(first.version_id);
    await expect(env.DB.prepare("SELECT current_version_id, gallery_version_id FROM artifacts WHERE id = ?").bind(first.artifact_id).first()).resolves.toEqual({ current_version_id: version.version_id, gallery_version_id: null });

    const unconfirmed = await mcpCall(token, "share_artifact", {
      artifact_id: first.artifact_id,
      version_id: first.version_id,
      confirm: false,
    });
    expect(unconfirmed.response.status).toBe(200);
    expect(serialized(unconfirmed.body)).toContain("invalid_input");
    await expect(env.DB.prepare("SELECT visibility, gallery_version_id FROM artifacts WHERE id = ?").bind(first.artifact_id).first()).resolves.toEqual({ visibility: "private", gallery_version_id: null });

    const shared = mutation((await mcpCall(token, "share_artifact", {
      artifact_id: first.artifact_id,
      version_id: first.version_id,
      confirm: true,
    })).body);
    expect(shared).toMatchObject({ artifact_id: first.artifact_id, version_id: first.version_id, visibility: "gallery" });
    await expect(env.DB.prepare("SELECT visibility, gallery_version_id FROM artifacts WHERE id = ?").bind(first.artifact_id).first()).resolves.toEqual({ visibility: "gallery", gallery_version_id: first.version_id });
  });

  it("returns the same completed artifact for concurrent identical MCP creates", async () => {
    const seeded = await seedTwoClubProjects();
    const token = await accessTokenFor(seeded.userId, seeded.firstClub.id);
    const input = artifactInput(seeded.firstClub.projectId, "concurrent-dashboard-create");

    const calls = await Promise.all([
      mcpCall(token, "create_artifact", input),
      mcpCall(token, "create_artifact", input),
    ]);
    expect(calls.map(({ response }) => response.status)).toEqual([200, 200]);
    const [first, retry] = calls.map(({ body }) => mutation(body));
    expect(retry).toMatchObject({ artifact_id: first.artifact_id, version_id: first.version_id });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE id = ?").bind(first.artifact_id).first()).resolves.toEqual({ count: 1 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE artifact_id = ?").bind(first.artifact_id).first()).resolves.toEqual({ count: 1 });
  });

  it("enforces OAuth artifact scopes and the club selected by the grant", async () => {
    const seeded = await seedTwoClubProjects();
    const readToken = await accessTokenFor(seeded.userId, seeded.firstClub.id, "projects:read");
    const writeToken = await accessTokenFor(seeded.userId, seeded.firstClub.id, "artifacts:write");
    const publishToken = await accessTokenFor(seeded.userId, seeded.firstClub.id, "artifacts:publish");
    const secondClubToken = await accessTokenFor(seeded.userId, seeded.secondClub.id);

    const noCreate = await mcpCall(readToken, "create_artifact", artifactInput(seeded.firstClub.projectId, "scope-read"));
    expect(noCreate.response.status).toBe(403);
    expect(noCreate.response.headers.get("WWW-Authenticate")).toContain("artifacts:write");

    const first = mutation((await mcpCall(writeToken, "create_artifact", artifactInput(seeded.firstClub.projectId, "club-a-create"))).body);
    const noShare = await mcpCall(writeToken, "share_artifact", { artifact_id: first.artifact_id, version_id: first.version_id, confirm: true });
    expect(noShare.response.status).toBe(403);
    expect(noShare.response.headers.get("WWW-Authenticate")).toContain("artifacts:publish");

    const crossCreate = await mcpCall(writeToken, "create_artifact", artifactInput(seeded.secondClub.projectId, "cross-club-create"));
    expect(serialized(crossCreate.body)).toContain("not_found");

    const second = mutation((await mcpCall(secondClubToken, "create_artifact", artifactInput(seeded.secondClub.projectId, "club-b-create"))).body);
    const crossVersion = await mcpCall(writeToken, "create_artifact_version", {
      artifact_id: second.artifact_id,
      files: [{ path: "index.html", content: "<!doctype html><main>Forbidden</main>" }],
      idempotency_key: "cross-club-version",
    });
    expect(serialized(crossVersion.body)).toContain("not_found");
    const crossShare = await mcpCall(publishToken, "share_artifact", { artifact_id: second.artifact_id, version_id: second.version_id, confirm: true });
    expect(serialized(crossShare.body)).toContain("not_found");
  });

  it("rejects invalid artifact packages without artifact rows and redacts mutation results", async () => {
    const seeded = await seedTwoClubProjects();
    const grant = await oauthGrantFor(seeded.userId, seeded.firstClub.id);
    const token = grant.accessToken;
    const forbiddenSecrets = [
      seeded.userId,
      `${seeded.userId}@example.test`,
      grant.accessToken,
      `Bearer ${grant.accessToken}`,
      grant.clientId,
      grant.code,
    ];
    const invalidCalls = [
      artifactInput(seeded.firstClub.projectId, "missing-root", [{ path: "app.css", content: "main {}" }]),
      artifactInput(seeded.firstClub.projectId, "traversal", [{ path: "../index.html", content: "<!doctype html>" }]),
      artifactInput(seeded.firstClub.projectId, "mime-mismatch", [{ path: "index.html", content: "<!doctype html>", mime_type: "text/plain" }]),
      artifactInput(seeded.firstClub.projectId, "too-many", Array.from({ length: 101 }, (_, index) => ({ path: index === 0 ? "index.html" : `asset-${index}.css`, content: "x" }))),
      artifactInput(seeded.firstClub.projectId, "too-large", [
        { path: "index.html", content: "<!doctype html>" },
        { path: "asset.css", content: "x".repeat(2 * 1024 * 1024) },
      ]),
    ];

    for (const input of invalidCalls) {
      const failed = await mcpCall(token, "create_artifact", input);
      expect(failed.response.status).toBe(200);
      const output = serialized(failed.body);
      expect(output).toContain("invalid_input");
      for (const forbidden of [...forbiddenSecrets, "mcp", "artifacts/", "r2_key", "r2Key", "object_key", "objectKey", "bucket", "capability", "SQLITE_", "D1_ERROR", "provider error", "OAuthProvider", "Error:", "at "]) {
        expect(output).not.toContain(forbidden);
      }
    }
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE user_id = ?").bind(seeded.userId).first()).resolves.toEqual({ count: 0 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE created_by = ?").bind(seeded.userId).first()).resolves.toEqual({ count: 0 });

    const created = await mcpCall(token, "create_artifact", artifactInput(seeded.firstClub.projectId, "redacted-success"));
    expect(created.response.status).toBe(200);
    expect(mutation(created.body)).toMatchObject({ visibility: "private" });
    const output = serialized(created.body);
    for (const forbidden of [...forbiddenSecrets, "mcp", "/versions/", "r2_key", "r2Key", "object_key", "objectKey", "bucket", "capability", "SQLITE_", "D1_ERROR", "provider error", "OAuthProvider", "Error:", "at "]) {
      expect(output).not.toContain(forbidden);
    }
  });
});
