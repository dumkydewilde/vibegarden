import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Club, ClubMembership, ClubRole, User } from "../../app/db/schema";
import {
  createClub,
  isValidClubSlug,
  listUserClubs,
  normalizeClubSlug,
} from "../../app/lib/clubs.server";
import type { ClubContext } from "../../app/lib/clubs.server";
import {
  archiveClub,
  changeMemberRole,
  leaveClub,
  removeMember,
  restoreClub,
  transferOwnership,
} from "../../app/lib/memberships.server";

const testEnv = { DB: env.DB } as Env;

async function insertUser(
  id: string,
  platformRole: "user" | "super_admin" = "user",
) {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO users (id, email, platform_role, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, `${id}@example.com`, platformRole, now)
    .run();
  return (await env.DB.prepare(
    "SELECT id, email, name, role, stage, model_pref AS modelPref, platform_role AS platformRole, theme_pref AS themePref, last_club_id AS lastClubId, created_at AS createdAt FROM users WHERE id = ?",
  )
    .bind(id)
    .first<User>())!;
}

async function insertMembership(
  clubId: string,
  userId: string,
  role: ClubRole,
) {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(clubId, userId, role, now, now)
    .run();
}

async function membership(clubId: string, userId: string) {
  return env.DB.prepare(
    "SELECT club_id AS clubId, user_id AS userId, role, onboarding_stage AS onboardingStage, model_pref AS modelPref, joined_at AS joinedAt, updated_at AS updatedAt FROM club_memberships WHERE club_id = ? AND user_id = ?",
  )
    .bind(clubId, userId)
    .first<ClubMembership>();
}

function context(club: Club, member: ClubMembership, role = member.role): ClubContext {
  return {
    club,
    membership: member,
    effectiveRole: role,
    isSuperAdmin: false,
  };
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

describe("club creation", () => {
  it("normalizes slugs and rejects malformed or reserved values", async () => {
    expect(normalizeClubSlug("  Café -- Garden!  ")).toBe("caf-garden");
    expect(isValidClubSlug("valid-club")).toBe(true);
    expect(isValidClubSlug("a")).toBe(true);
    expect(isValidClubSlug("admin")).toBe(false);

    const creator = await insertUser("creation-invalid");
    for (const slug of ["???", "admin"]) {
      const response = await capturedResponse(() =>
        createClub(testEnv, creator, { name: "Invalid club", slug }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("rejects canonical and aliased slug collisions", async () => {
    const creator = await insertUser("creation-collision");
    const club = await createClub(testEnv, creator, {
      name: "Collision club",
      slug: "collision-club",
    });
    await env.DB.prepare(
      "INSERT INTO club_slug_aliases (slug, club_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("former-collision-club", club.id, Date.now())
      .run();

    for (const slug of ["collision-club", "former-collision-club"]) {
      const response = await capturedResponse(() =>
        createClub(testEnv, creator, { name: "Another club", slug }),
      );
      expect(response.status).toBe(409);
    }
  });

  it("creates independent owner clubs with the free-only default and audit trail", async () => {
    const creator = await insertUser("creation-owner");
    const first = await createClub(testEnv, creator, {
      name: "First Club",
      slug: " First Club ",
    });
    const second = await createClub(testEnv, creator, {
      name: "Second Club",
      slug: "second-club",
    });

    expect(first.slug).toBe("first-club");
    expect(first.modelPolicy).toBe("free_only");
    expect((await membership(first.id, creator.id))?.role).toBe("owner");
    expect((await membership(second.id, creator.id))?.role).toBe("owner");
    expect(
      await env.DB.prepare(
        "SELECT provisioning_state FROM club_ai_credentials WHERE club_id = ?",
      )
        .bind(first.id)
        .first<{ provisioning_state: string }>(),
    ).toEqual({ provisioning_state: "pending" });
    expect(
      await env.DB.prepare("SELECT last_club_id FROM users WHERE id = ?")
        .bind(creator.id)
        .first<{ last_club_id: string }>(),
    ).toEqual({ last_club_id: second.id });
    expect(
      await env.DB.prepare(
        "SELECT action, target_id FROM audit_events WHERE club_id = ?",
      )
        .bind(first.id)
        .first<{ action: string; target_id: string }>(),
    ).toEqual({ action: "club.created", target_id: first.id });
    expect(await listUserClubs(testEnv, creator.id)).toHaveLength(2);
  });
});

describe("membership lifecycle", () => {
  it("does not allow the final owner to leave, be removed, or be demoted", async () => {
    const owner = await insertUser("lifecycle-final-owner");
    const club = await createClub(testEnv, owner, {
      name: "Final owner club",
      slug: "final-owner-club",
    });
    const ownerMembership = (await membership(club.id, owner.id))!;
    const ownerContext = context(club, ownerMembership);

    for (const mutation of [
      () => leaveClub(testEnv, ownerContext),
      () => removeMember(testEnv, ownerContext, owner.id),
      () => changeMemberRole(testEnv, ownerContext, owner.id, "admin"),
    ]) {
      expect((await capturedResponse(mutation)).status).toBe(409);
    }
    expect((await membership(club.id, owner.id))?.role).toBe("owner");
  });

  it("rejects owner promotion and unknown roles without changing ownership", async () => {
    const owner = await insertUser("lifecycle-role-owner");
    const member = await insertUser("lifecycle-role-member");
    const club = await createClub(testEnv, owner, {
      name: "Role validation club",
      slug: "role-validation-club",
    });
    await insertMembership(club.id, member.id, "member");
    const ownerContext = context(club, (await membership(club.id, owner.id))!);

    for (const role of ["owner", "unknown"]) {
      expect(
        (await capturedResponse(() =>
          changeMemberRole(testEnv, ownerContext, member.id, role as ClubRole),
        )).status,
      ).toBe(400);
    }
    expect((await membership(club.id, member.id))?.role).toBe("member");
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM club_memberships WHERE club_id = ? AND role = 'owner'",
      )
        .bind(club.id)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });

  it("limits admins to removing members and records successful removals", async () => {
    const owner = await insertUser("lifecycle-admin-owner");
    const admin = await insertUser("lifecycle-admin");
    const member = await insertUser("lifecycle-member");
    const otherAdmin = await insertUser("lifecycle-other-admin");
    const club = await createClub(testEnv, owner, {
      name: "Admin limits club",
      slug: "admin-limits-club",
    });
    await insertMembership(club.id, admin.id, "admin");
    await insertMembership(club.id, member.id, "member");
    await insertMembership(club.id, otherAdmin.id, "admin");
    const adminContext = context(club, (await membership(club.id, admin.id))!);

    expect(
      (await capturedResponse(() =>
        changeMemberRole(testEnv, adminContext, member.id, "admin"),
      )).status,
    ).toBe(404);
    expect(
      (await capturedResponse(() =>
        removeMember(testEnv, adminContext, otherAdmin.id),
      )).status,
    ).toBe(404);

    await removeMember(testEnv, adminContext, member.id);
    expect(await membership(club.id, member.id)).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT action FROM audit_events WHERE club_id = ? AND target_id = ?",
      )
        .bind(club.id, member.id)
        .first<{ action: string }>(),
    ).toEqual({ action: "member.removed" });
  });

  it("transfers ownership atomically and rejects stale owner actions", async () => {
    const owner = await insertUser("lifecycle-transfer-owner");
    const successor = await insertUser("lifecycle-transfer-successor");
    const club = await createClub(testEnv, owner, {
      name: "Transfer club",
      slug: "transfer-club",
    });
    await insertMembership(club.id, successor.id, "admin");
    const staleOwnerContext = context(
      club,
      (await membership(club.id, owner.id))!,
    );

    await transferOwnership(testEnv, staleOwnerContext, successor.id);

    expect((await membership(club.id, successor.id))?.role).toBe("owner");
    expect((await membership(club.id, owner.id))?.role).toBe("admin");
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM club_memberships WHERE club_id = ? AND role = 'owner'",
      )
        .bind(club.id)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
    expect(
      (await capturedResponse(() =>
        transferOwnership(testEnv, staleOwnerContext, successor.id),
      )).status,
    ).toBe(409);
  });

  it("checks the actor's current role before stale owner contexts mutate", async () => {
    const owner = await insertUser("lifecycle-stale-owner");
    const successor = await insertUser("lifecycle-stale-successor");
    const member = await insertUser("lifecycle-stale-member");
    const club = await createClub(testEnv, owner, {
      name: "Stale context club",
      slug: "stale-context-club",
    });
    await insertMembership(club.id, successor.id, "admin");
    await insertMembership(club.id, member.id, "member");
    const staleOwnerContext = context(
      club,
      (await membership(club.id, owner.id))!,
    );

    await transferOwnership(testEnv, staleOwnerContext, successor.id);

    for (const mutation of [
      () => archiveClub(testEnv, staleOwnerContext),
      () => changeMemberRole(testEnv, staleOwnerContext, member.id, "admin"),
    ]) {
      expect((await capturedResponse(mutation)).status).toBe(409);
    }
    expect(
      await env.DB.prepare("SELECT status FROM clubs WHERE id = ?")
        .bind(club.id)
        .first<{ status: string }>(),
    ).toEqual({ status: "active" });
    expect((await membership(club.id, member.id))?.role).toBe("member");
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM club_memberships WHERE club_id = ? AND role = 'owner'",
      )
        .bind(club.id)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_events WHERE club_id = ? AND action IN ('club.archived', 'member.role_changed')",
      )
        .bind(club.id)
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("lets an owner archive a club and only a super admin restore it", async () => {
    const owner = await insertUser("lifecycle-archive-owner");
    const normalUser = await insertUser("lifecycle-restore-user");
    const superAdmin = await insertUser(
      "lifecycle-restore-super-admin",
      "super_admin",
    );
    const club = await createClub(testEnv, owner, {
      name: "Archive club",
      slug: "archive-club",
    });
    await archiveClub(testEnv, context(club, (await membership(club.id, owner.id))!));
    expect(
      await env.DB.prepare("SELECT status FROM clubs WHERE id = ?")
        .bind(club.id)
        .first<{ status: string }>(),
    ).toEqual({ status: "archived" });

    expect(
      (await capturedResponse(() => restoreClub(testEnv, normalUser, club.id)))
        .status,
    ).toBe(404);
    await restoreClub(testEnv, superAdmin, club.id);
    expect(
      await env.DB.prepare("SELECT status FROM clubs WHERE id = ?")
        .bind(club.id)
        .first<{ status: string }>(),
    ).toEqual({ status: "active" });
    expect(
      await env.DB.prepare(
        "SELECT action FROM audit_events WHERE club_id = ? AND action = 'club.restored'",
      )
        .bind(club.id)
        .first<{ action: string }>(),
    ).toEqual({ action: "club.restored" });
  });
});
