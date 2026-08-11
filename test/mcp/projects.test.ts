import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://vibegarden.test";
const REDIRECT_URI = "http://127.0.0.1:54321/callback";

function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function accessTokenFor(userId: string, clubId: string, scopes = "projects:write projects:read") {
  const registration = await SELF.fetch(`${ORIGIN}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" }),
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = await registration.json() as { client_id: string };

  const verifier = "a-long-pkce-verifier-used-only-for-real-mcp-project-tests";
  const codeChallenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const authorization = await SELF.fetch(`${ORIGIN}/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: scopes,
    resource: `${ORIGIN}/mcp`,
    state: "project-test-state",
  })}`, {
    headers: { "x-test-user-id": userId, "x-test-club-id": clubId },
    redirect: "manual",
  });
  expect(authorization.status).toBe(302);
  const code = new URL(authorization.headers.get("location")!).searchParams.get("code");

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
  return (await token.json() as { access_token: string }).access_token;
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

type PresentedProject = {
  id: string;
  title: string;
  one_liner: string | null;
  notes: string | null;
  status: string;
  building_blocks: string[];
  url: string;
};

function presented(body: Record<string, unknown>): PresentedProject {
  return (body.result as { structuredContent: PresentedProject }).structuredContent;
}

function serialized(body: Record<string, unknown>) {
  return JSON.stringify(body);
}

async function seedTwoClubs() {
  const suffix = crypto.randomUUID();
  const userId = `project-user-${suffix}`;
  const firstClub = { id: `project-club-a-${suffix}`, slug: `project-club-a-${suffix}` };
  const secondClub = { id: `project-club-b-${suffix}`, slug: `project-club-b-${suffix}` };
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name, role, stage, created_at) VALUES (?, ?, 'Project user', 'user', 'exploring', ?)").bind(userId, `${userId}@example.test`, now),
    ...[firstClub, secondClub].flatMap((club) => [
      env.DB.prepare("INSERT INTO clubs (id, name, slug, model_policy, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'all_models', 'active', ?, ?, ?)").bind(club.id, `Club ${club.id}`, club.slug, userId, now, now),
      env.DB.prepare("INSERT INTO club_memberships (club_id, user_id, role, onboarding_stage, joined_at, updated_at) VALUES (?, ?, 'member', 'exploring', ?, ?)").bind(club.id, userId, now, now),
    ]),
  ]);
  return { userId, firstClub, secondClub };
}

const createInput = {
  title: "Reading-habit dashboard",
  one_liner: "Chart my Goodreads export",
  notes: "Loaded the export into DuckDB in the browser.",
  building_blocks: [],
  idempotency_key: "reading-dashboard-create-v1",
};

describe("MCP project writes", () => {
  it("creates a project in the club the grant selected", async () => {
    const seeded = await seedTwoClubs();
    const token = await accessTokenFor(seeded.userId, seeded.firstClub.id);
    const { response, body } = await mcpCall(token, "create_project", createInput);

    expect(response.status).toBe(200);
    const project = presented(body);
    expect(project).toMatchObject({
      title: "Reading-habit dashboard",
      one_liner: "Chart my Goodreads export",
      notes: "Loaded the export into DuckDB in the browser.",
      status: "seed",
      building_blocks: [],
      url: `${ORIGIN}/clubs/${seeded.firstClub.slug}/garden/projects/${project.id}`,
    });
    await expect(env.DB.prepare("SELECT user_id, club_id, notes FROM projects WHERE id = ?").bind(project.id).first())
      .resolves.toEqual({
        user_id: seeded.userId,
        club_id: seeded.firstClub.id,
        notes: "Loaded the export into DuckDB in the browser.",
      });
  });

  it("replays a repeated idempotency key instead of planting a duplicate", async () => {
    const seeded = await seedTwoClubs();
    const token = await accessTokenFor(seeded.userId, seeded.firstClub.id);

    const first = presented((await mcpCall(token, "create_project", createInput)).body);
    const retry = presented((await mcpCall(token, "create_project", createInput)).body);
    const concurrent = await Promise.all([
      mcpCall(token, "create_project", { ...createInput, idempotency_key: "concurrent-create" }),
      mcpCall(token, "create_project", { ...createInput, idempotency_key: "concurrent-create" }),
    ]);

    expect(retry.id).toBe(first.id);
    const [raced, racedRetry] = concurrent.map(({ body }) => presented(body));
    expect(racedRetry.id).toBe(raced.id);
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id = ?").bind(seeded.userId).first())
      .resolves.toEqual({ count: 2 });
  });

  it("updates only the fields it is given and resolves building blocks by slug or title", async () => {
    const seeded = await seedTwoClubs();
    const token = await accessTokenFor(seeded.userId, seeded.firstClub.id);
    const created = presented((await mcpCall(token, "create_project", createInput)).body);

    const updated = presented((await mcpCall(token, "update_project", {
      project_id: created.id,
      notes: "Charted books per year. Next: filter out re-reads.",
      status: "growing",
      building_blocks: ["dashboard"],
    })).body);

    expect(updated).toMatchObject({
      id: created.id,
      title: "Reading-habit dashboard",
      one_liner: "Chart my Goodreads export",
      notes: "Charted books per year. Next: filter out re-reads.",
      status: "growing",
      building_blocks: ["Dashboard"],
    });

    const cleared = presented((await mcpCall(token, "update_project", {
      project_id: created.id,
      one_liner: "",
    })).body);
    expect(cleared.one_liner).toBeNull();
    expect(cleared.status).toBe("growing");
  });

  it("rejects unknown building blocks, empty updates, and over-long notes without writing", async () => {
    const seeded = await seedTwoClubs();
    const token = await accessTokenFor(seeded.userId, seeded.firstClub.id);
    const created = presented((await mcpCall(token, "create_project", createInput)).body);

    const invalidCalls: Array<[string, Record<string, unknown>]> = [
      ["update_project", { project_id: created.id, building_blocks: ["Not a building block"] }],
      ["update_project", { project_id: created.id }],
      ["update_project", { project_id: created.id, notes: "x".repeat(4_001) }],
      ["update_project", { project_id: created.id, status: "wilted" }],
      ["create_project", { title: "", idempotency_key: "empty-title" }],
      ["create_project", { title: "No key" }],
    ];

    for (const [name, args] of invalidCalls) {
      const failed = await mcpCall(token, name, args);
      expect(failed.response.status).toBe(200);
      expect(serialized(failed.body)).toContain("invalid_input");
    }
    await expect(env.DB.prepare("SELECT notes, status, modules FROM projects WHERE id = ?").bind(created.id).first())
      .resolves.toEqual({
        notes: "Loaded the export into DuckDB in the browser.",
        status: "seed",
        modules: "[]",
      });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id = ?").bind(seeded.userId).first())
      .resolves.toEqual({ count: 1 });
  });

  it("enforces the projects:write scope and the club the grant selected", async () => {
    const seeded = await seedTwoClubs();
    const readToken = await accessTokenFor(seeded.userId, seeded.firstClub.id, "projects:read");
    const firstClubToken = await accessTokenFor(seeded.userId, seeded.firstClub.id, "projects:write");
    const secondClubToken = await accessTokenFor(seeded.userId, seeded.secondClub.id, "projects:write");
    const otherUserToken = await accessTokenFor(`outsider-${crypto.randomUUID()}`, seeded.firstClub.id, "projects:write");

    const noCreate = await mcpCall(readToken, "create_project", createInput);
    expect(noCreate.response.status).toBe(403);
    expect(noCreate.response.headers.get("WWW-Authenticate")).toContain("projects:write");

    const created = presented((await mcpCall(firstClubToken, "create_project", createInput)).body);
    for (const token of [secondClubToken, otherUserToken]) {
      const crossUpdate = await mcpCall(token, "update_project", {
        project_id: created.id,
        notes: "Written from the wrong grant.",
      });
      expect(serialized(crossUpdate.body)).toContain("not_found");
    }
    await expect(env.DB.prepare("SELECT notes FROM projects WHERE id = ?").bind(created.id).first())
      .resolves.toEqual({ notes: "Loaded the export into DuckDB in the browser." });
  });
});
