import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSessionCookie } from "../../app/lib/auth.server";
import { requireClubContext } from "../../app/lib/clubs.server";

const testEnv = { DB: env.DB, SESSION_SECRET: "club-context-test-secret" } as Env;

async function insertUser(
  id: string,
  platformRole: "user" | "super_admin" = "user",
) {
  await env.DB.prepare(
    "INSERT INTO users (id, email, platform_role, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, `${id}@example.com`, platformRole, Date.now())
    .run();
}

async function insertClub(
  id: string,
  slug: string,
  status: "active" | "archived" = "active",
) {
  await env.DB.prepare(
    "INSERT INTO clubs (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, `Private ${slug} club`, slug, status, Date.now(), Date.now())
    .run();
}

async function insertMembership(
  clubId: string,
  userId: string,
  role: "owner" | "admin" | "member",
) {
  await env.DB.prepare(
    "INSERT INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(clubId, userId, role, Date.now(), Date.now())
    .run();
}

async function authenticatedRequest(userId: string, url: string) {
  const cookie = await createSessionCookie(
    testEnv,
    new Request(url),
    userId,
  );
  return new Request(url, { headers: { Cookie: cookie } });
}

async function capturedResponse(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected a response to be thrown");
}

describe("requireClubContext", () => {
  it("resolves an active club member", async () => {
    const userId = "context-member";
    await insertUser(userId);
    await insertClub("club-context-member", "context-member");
    await insertMembership("club-context-member", userId, "member");
    const request = await authenticatedRequest(
      userId,
      "https://vibegarden.test/clubs/context-member/garden",
    );

    const context = await requireClubContext(testEnv, request, "context-member");

    expect(context.club.id).toBe("club-context-member");
    expect(context.membership?.role).toBe("member");
    expect(context.effectiveRole).toBe("member");
    expect(context.isSuperAdmin).toBe(false);
  });

  it("returns a neutral 404 for a non-member", async () => {
    const userId = "context-outsider";
    await insertUser(userId);
    await insertClub("club-context-private", "private-context");
    const request = await authenticatedRequest(
      userId,
      "https://vibegarden.test/clubs/private-context/garden",
    );

    const response = await capturedResponse(() =>
      requireClubContext(testEnv, request, "private-context"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Private private-context club");
  });

  it("redirects an alias while preserving the suffix and query string", async () => {
    const userId = "context-alias";
    await insertUser(userId);
    await insertClub("club-context-alias", "new-context");
    await insertMembership("club-context-alias", userId, "member");
    await env.DB.prepare(
      "INSERT INTO club_slug_aliases (slug, club_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("old-context", "club-context-alias", Date.now())
      .run();
    const request = await authenticatedRequest(
      userId,
      "https://vibegarden.test/clubs/old-context/garden/projects?filter=active",
    );

    const response = await capturedResponse(() =>
      requireClubContext(testEnv, request, "old-context"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://vibegarden.test/clubs/new-context/garden/projects?filter=active",
    );
  });

  it("gives a super-admin admin access without creating a membership", async () => {
    const userId = "context-super-admin";
    await insertUser(userId, "super_admin");
    await insertClub("club-context-super-admin", "super-context");
    const request = await authenticatedRequest(
      userId,
      "https://vibegarden.test/clubs/super-context/admin",
    );

    const context = await requireClubContext(testEnv, request, "super-context");

    expect(context.membership).toBeNull();
    expect(context.effectiveRole).toBe("admin");
    expect(context.isSuperAdmin).toBe(true);
  });

  it("uses an explicit super-admin membership role over admin fallback", async () => {
    const userId = "context-explicit-super-admin";
    await insertUser(userId, "super_admin");
    await insertClub("club-context-explicit-super-admin", "explicit-super-context");
    await insertMembership("club-context-explicit-super-admin", userId, "owner");
    const request = await authenticatedRequest(
      userId,
      "https://vibegarden.test/clubs/explicit-super-context",
    );

    const context = await requireClubContext(
      testEnv,
      request,
      "explicit-super-context",
    );

    expect(context.membership?.role).toBe("owner");
    expect(context.effectiveRole).toBe("owner");
    expect(context.isSuperAdmin).toBe(true);
  });

  it("returns a neutral 404 for an archived club", async () => {
    const userId = "context-archived";
    await insertUser(userId);
    await insertClub("club-context-archived", "archived-context", "archived");
    await insertMembership("club-context-archived", userId, "member");
    const request = await authenticatedRequest(
      userId,
      "https://vibegarden.test/clubs/archived-context",
    );

    const response = await capturedResponse(() =>
      requireClubContext(testEnv, request, "archived-context"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Private archived-context club");
  });
});
