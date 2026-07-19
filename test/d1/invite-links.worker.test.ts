import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Club, ClubMembership, User } from "../../app/db/schema";
import type { ClubContext } from "../../app/lib/clubs.server";
import {
  acceptPendingEmailInvitations,
  createInviteLink,
  createEmailInvitation,
  getInvitePreview,
  joinWithInviteLink,
} from "../../app/lib/invites.server";
import { requestLoginCode } from "../../app/lib/otp.server";
import { verifyValue } from "../../app/lib/auth.server";
import { googleAuthRedirect } from "../../app/lib/google.server";

const testEnv = { DB: env.DB } as Env;

async function insertUser(id: string, email = `${id}@example.com`): Promise<User> {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)",
  )
    .bind(id, email, now)
    .run();
  return {
    id,
    email,
    name: null,
    role: "user",
    stage: "invited",
    modelPref: null,
    platformRole: "user",
    themePref: null,
    lastClubId: null,
    createdAt: now,
  };
}

async function insertClub(id: string): Promise<Club> {
  const now = Date.now();
  const club: Club = {
    id,
    name: `Club ${id}`,
    slug: id,
    modelPolicy: "free_only",
    status: "active",
    spendingLimitUsd: null,
    spendingLimitReset: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await env.DB.prepare(
    "INSERT INTO clubs (id, name, slug, model_policy, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      club.id,
      club.name,
      club.slug,
      club.modelPolicy,
      club.status,
      club.createdAt,
      club.updatedAt,
    )
    .run();
  return club;
}

async function insertMembership(clubId: string, userId: string, role: "owner" | "admin" | "member" = "owner") {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(clubId, userId, role, now, now)
    .run();
  return {
    clubId,
    userId,
    role,
    onboardingStage: "invited",
    modelPref: null,
    joinedAt: now,
    updatedAt: now,
  } satisfies ClubMembership;
}

async function context(id: string) {
  const owner = await insertUser(`${id}-owner`);
  const club = await insertClub(`${id}-club`);
  const membership = await insertMembership(club.id, owner.id);
  return {
    club,
    membership,
    effectiveRole: "owner",
    isSuperAdmin: false,
  } satisfies ClubContext;
}

describe("club email invitations", () => {
  it("adds an existing account to the scoped club immediately", async () => {
    const clubContext = await context("email-immediate");
    const invitee = await insertUser("email-immediate-invitee", "member@example.com");

    const invitation = await createEmailInvitation(
      testEnv,
      clubContext,
      "Member@example.com",
    );

    expect(invitation.clubId).toBe(clubContext.club.id);
    expect(invitation.email).toBe("member@example.com");
    expect(invitation.status).toBe("joined");
    expect(
      await env.DB
        .prepare("SELECT 1 AS member FROM club_memberships WHERE club_id = ? AND user_id = ?")
        .bind(clubContext.club.id, invitee.id)
        .first(),
    ).toEqual({ member: 1 });
  });

  it("adds a newly verified account after accepting its pending invitation", async () => {
    const clubContext = await context("email-deferred");
    const email = "new-member@example.com";

    const invitation = await createEmailInvitation(testEnv, clubContext, email);
    const user = await insertUser("email-deferred-invitee", email);
    await acceptPendingEmailInvitations(testEnv, user);

    expect(invitation.status).toBe("pending");
    expect(
      await env.DB
        .prepare("SELECT status, accepted_at AS acceptedAt FROM club_invitations WHERE id = ?")
        .bind(invitation.id)
        .first(),
    ).toMatchObject({ status: "joined" });
    expect(
      await env.DB
        .prepare("SELECT 1 AS member FROM club_memberships WHERE club_id = ? AND user_id = ?")
        .bind(clubContext.club.id, user.id)
        .first(),
    ).toEqual({ member: 1 });
  });

  it("admits existing accounts and club-invited email addresses to email sign-in", async () => {
    const existing = await insertUser("admission-existing", "existing@example.com");
    const clubContext = await context("admission-invited");
    await createEmailInvitation(testEnv, clubContext, "invited@example.com");

    await expect(requestLoginCode(testEnv, existing.email)).resolves.toMatchObject({ ok: true });
    await expect(requestLoginCode(testEnv, "invited@example.com")).resolves.toMatchObject({ ok: true });
    await expect(requestLoginCode(testEnv, "outsider@example.com")).resolves.toEqual({
      ok: false,
      error: "not-invited",
    });
  });
});

describe("club invite links", () => {
  it("admits a new email to sign in through a usable invite link", async () => {
    const clubContext = await context("login-admission");
    const { urlToken } = await createInviteLink(testEnv, clubContext, {
      expiresIn: "24h",
    });

    await expect(
      requestLoginCode(
        testEnv,
        "link-invitee@example.com",
        `/join/${urlToken}`,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("keeps unavailable invite links closed to new email addresses", async () => {
    const clubContext = await context("closed-login-admission");
    const { urlToken, link } = await createInviteLink(testEnv, clubContext, {
      expiresIn: "1h",
    });
    await env.DB.prepare(
      "UPDATE club_invite_links SET revoked_at = ? WHERE id = ?",
    )
      .bind(Date.now(), link.id)
      .run();

    await expect(
      requestLoginCode(
        testEnv,
        "closed-link-invitee@example.com",
        `/join/${urlToken}`,
      ),
    ).resolves.toEqual({ ok: false, error: "not-invited" });
  });

  it.each([
    ["1h", 60 * 60 * 1000],
    ["24h", 24 * 60 * 60 * 1000],
    ["7d", 7 * 24 * 60 * 60 * 1000],
    ["30d", 30 * 24 * 60 * 60 * 1000],
  ] as const)("parses %s as an allowed expiry", async (expiresIn, duration) => {
    const clubContext = await context(`expiry-${expiresIn}`);
    const before = Date.now();

    const { urlToken, link } = await createInviteLink(testEnv, clubContext, {
      expiresIn,
    });

    expect(urlToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.tokenHash).not.toBe(urlToken);
    expect(link.expiresAt).toBeGreaterThanOrEqual(before + duration);
    expect(link.expiresAt).toBeLessThanOrEqual(Date.now() + duration);
  });

  it("previews a usable link without creating membership", async () => {
    const clubContext = await context("preview");
    const { urlToken } = await createInviteLink(testEnv, clubContext, {
      expiresIn: "24h",
    });

    expect(await getInvitePreview(testEnv, urlToken)).toEqual({
      clubName: clubContext.club.name,
      available: true,
    });
    expect(
      await env.DB
        .prepare("SELECT COUNT(*) AS count FROM club_memberships WHERE club_id = ?")
        .bind(clubContext.club.id)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });

  it("uses one neutral unavailable result for malformed, expired, revoked, and exhausted links", async () => {
    const clubContext = await context("unavailable");
    const { urlToken, link } = await createInviteLink(testEnv, clubContext, {
      expiresIn: "1h",
      maxJoins: 1,
    });
    const unavailable = { clubName: null, available: false };

    expect(await getInvitePreview(testEnv, "not-a-valid-token")).toEqual(unavailable);
    await env.DB.prepare("UPDATE club_invite_links SET expires_at = ? WHERE id = ?")
      .bind(Date.now() - 1, link.id)
      .run();
    expect(await getInvitePreview(testEnv, urlToken)).toEqual(unavailable);
    await env.DB.prepare("UPDATE club_invite_links SET expires_at = NULL, revoked_at = ? WHERE id = ?")
      .bind(Date.now(), link.id)
      .run();
    expect(await getInvitePreview(testEnv, urlToken)).toEqual(unavailable);
    await env.DB.prepare("UPDATE club_invite_links SET revoked_at = NULL, current_joins = max_joins WHERE id = ?")
      .bind(link.id)
      .run();
    expect(await getInvitePreview(testEnv, urlToken)).toEqual(unavailable);
  });

  it("makes repeated joins idempotent and records link provenance once", async () => {
    const clubContext = await context("idempotent");
    const user = await insertUser("idempotent-user");
    const { urlToken, link } = await createInviteLink(testEnv, clubContext, {
      expiresIn: "24h",
      maxJoins: 2,
    });

    await expect(joinWithInviteLink(testEnv, user, urlToken)).resolves.toEqual({
      ok: true,
      clubSlug: clubContext.club.slug,
    });
    await expect(joinWithInviteLink(testEnv, user, urlToken)).resolves.toMatchObject({ ok: true });
    expect(
      await env.DB
        .prepare("SELECT current_joins AS currentJoins FROM club_invite_links WHERE id = ?")
        .bind(link.id)
        .first(),
    ).toEqual({ currentJoins: 1 });
    expect(
      await env.DB
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE club_id = ? AND actor_user_id = ? AND action = 'membership.joined_via_link'")
        .bind(clubContext.club.id, user.id)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });

  it("allows exactly one concurrent user to claim a final link slot", async () => {
    const clubContext = await context("final-slot");
    const first = await insertUser("final-slot-first");
    const second = await insertUser("final-slot-second");
    const { urlToken, link } = await createInviteLink(testEnv, clubContext, {
      maxJoins: 1,
    });

    const results = await Promise.all([
      joinWithInviteLink(testEnv, first, urlToken),
      joinWithInviteLink(testEnv, second, urlToken),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB
        .prepare("SELECT current_joins AS currentJoins FROM club_invite_links WHERE id = ?")
        .bind(link.id)
        .first(),
    ).toEqual({ currentJoins: 1 });
  });
});

describe("Google invitation return path", () => {
  it("signs a same-origin join path into OAuth state", async () => {
    const request = new Request(
      "https://vibegarden.test/auth/google?next=%2Fjoin%2Fexample-token",
    );
    const oauthEnv = {
      ...testEnv,
      SESSION_SECRET: "google-invite-test-secret",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
    } as Env;

    const { stateCookie } = await googleAuthRedirect(oauthEnv, request);
    const signed = /vg_oauth_state=([^;]+)/.exec(stateCookie)?.[1];
    const state = await verifyValue(
      decodeURIComponent(signed!),
      oauthEnv.SESSION_SECRET,
    );

    expect(JSON.parse(state!)).toMatchObject({ next: "/join/example-token" });
  });
});
