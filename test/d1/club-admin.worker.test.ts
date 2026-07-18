import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Club, ClubMembership, ClubRole, User } from "../../app/db/schema";
import { requireClubPermission } from "../../app/lib/club-permissions";
import { createClub, renameClub, renameClubDisplayName, type ClubContext } from "../../app/lib/clubs.server";
import { createEmailInvitation, createInviteLink, revokeEmailInvitation, revokeInviteLink } from "../../app/lib/invites.server";
import { archiveClub, changeMemberRole, removeMember, transferOwnership } from "../../app/lib/memberships.server";

const testEnv = { DB: env.DB } as Env;

async function user(id: string, platformRole: "user" | "super_admin" = "user") {
  const now = Date.now();
  await env.DB.prepare("INSERT INTO users (id, email, platform_role, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, platformRole, now).run();
  return { id, email: `${id}@example.com`, name: null, role: "user", stage: "invited", modelPref: null, platformRole, themePref: null, lastClubId: null, createdAt: now } as User;
}

async function addMember(clubId: string, userId: string, role: ClubRole) {
  const now = Date.now();
  await env.DB.prepare("INSERT INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(clubId, userId, role, now, now).run();
  return (await env.DB.prepare("SELECT club_id AS clubId, user_id AS userId, role, onboarding_stage AS onboardingStage, model_pref AS modelPref, joined_at AS joinedAt, updated_at AS updatedAt FROM club_memberships WHERE club_id = ? AND user_id = ?")
    .bind(clubId, userId).first<ClubMembership>())!;
}

function context(club: Club, membership: ClubMembership | null, isSuperAdmin = false): ClubContext {
  return { club, membership, effectiveRole: membership?.role ?? "admin", isSuperAdmin };
}

async function response(operation: () => Promise<unknown>) {
  try { await operation(); } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected a permission response");
}

describe("club administration permission boundary", () => {
  it("gives admins invitation, moderation, and member-removal powers but never owner/admin powers", async () => {
    const owner = await user("club-admin-owner");
    const admin = await user("club-admin-admin");
    const member = await user("club-admin-member");
    const otherAdmin = await user("club-admin-other-admin");
    const club = await createClub(testEnv, owner, { name: "Club admin", slug: "club-admin" });
    const adminMembership = await addMember(club.id, admin.id, "admin");
    await addMember(club.id, member.id, "member");
    await addMember(club.id, otherAdmin.id, "admin");
    const adminContext = context(club, adminMembership);

    requireClubPermission(adminContext, "moderate");
    await createEmailInvitation(testEnv, adminContext, "invitee@example.com");
    await createInviteLink(testEnv, adminContext, { expiresIn: "24h", maxJoins: 2 });
    await removeMember(testEnv, adminContext, member.id);
    expect(await env.DB.prepare("SELECT 1 FROM club_memberships WHERE club_id = ? AND user_id = ?").bind(club.id, member.id).first()).toBeNull();

    for (const operation of [
      () => removeMember(testEnv, adminContext, owner.id),
      () => removeMember(testEnv, adminContext, otherAdmin.id),
      () => changeMemberRole(testEnv, adminContext, otherAdmin.id, "member"),
      () => transferOwnership(testEnv, adminContext, otherAdmin.id),
      () => archiveClub(testEnv, adminContext),
    ]) expect((await response(operation)).status).toBe(404);
  });

  it("reserves roles, ownership transfer, and archive for an explicit owner", async () => {
    const owner = await user("club-owner-owner");
    const admin = await user("club-owner-admin");
    const club = await createClub(testEnv, owner, { name: "Owner club", slug: "owner-club" });
    const ownerMembership = (await env.DB.prepare("SELECT club_id AS clubId, user_id AS userId, role, onboarding_stage AS onboardingStage, model_pref AS modelPref, joined_at AS joinedAt, updated_at AS updatedAt FROM club_memberships WHERE club_id = ? AND user_id = ?").bind(club.id, owner.id).first<ClubMembership>())!;
    await addMember(club.id, admin.id, "admin");
    const ownerContext = context(club, ownerMembership);

    await changeMemberRole(testEnv, ownerContext, admin.id, "member");
    await transferOwnership(testEnv, ownerContext, admin.id);
    const newOwner = (await env.DB.prepare("SELECT club_id AS clubId, user_id AS userId, role, onboarding_stage AS onboardingStage, model_pref AS modelPref, joined_at AS joinedAt, updated_at AS updatedAt FROM club_memberships WHERE club_id = ? AND user_id = ?").bind(club.id, admin.id).first<ClubMembership>())!;
    await archiveClub(testEnv, context(club, newOwner));
    expect(await env.DB.prepare("SELECT status FROM clubs WHERE id = ?").bind(club.id).first()).toEqual({ status: "archived" });
  });

  it("gives a super admin without membership only the effective-admin operations", async () => {
    const owner = await user("club-super-owner");
    const superAdmin = await user("club-super-admin", "super_admin");
    const member = await user("club-super-member");
    const admin = await user("club-super-explicit-admin");
    const club = await createClub(testEnv, owner, { name: "Super club", slug: "super-club" });
    await addMember(club.id, member.id, "member");
    await addMember(club.id, admin.id, "admin");
    const superContext = context(club, null, true);

    await createEmailInvitation(testEnv, superContext, "implicit-admin@example.com");
    await createInviteLink(testEnv, superContext, {});
    await removeMember(testEnv, superContext, member.id);
    expect((await response(() => removeMember(testEnv, superContext, owner.id))).status).toBe(404);
    expect((await response(() => removeMember(testEnv, superContext, admin.id))).status).toBe(404);
    for (const permission of ["manage_admin", "manage_identity", "transfer_ownership", "archive"] as const) {
      expect((await response(async () => requireClubPermission(superContext, permission))).status).toBe(404);
    }
  });

  it("keeps invitation revocation, settings, and archive mutations inside the current club", async () => {
    const firstOwner = await user("club-boundary-first-owner");
    const secondOwner = await user("club-boundary-second-owner");
    const first = await createClub(testEnv, firstOwner, { name: "First boundary club", slug: "first-boundary-club" });
    const second = await createClub(testEnv, secondOwner, { name: "Second boundary club", slug: "second-boundary-club" });
    const firstMembership = (await env.DB.prepare("SELECT club_id AS clubId, user_id AS userId, role, onboarding_stage AS onboardingStage, model_pref AS modelPref, joined_at AS joinedAt, updated_at AS updatedAt FROM club_memberships WHERE club_id = ? AND user_id = ?").bind(first.id, firstOwner.id).first<ClubMembership>())!;
    const secondMembership = (await env.DB.prepare("SELECT club_id AS clubId, user_id AS userId, role, onboarding_stage AS onboardingStage, model_pref AS modelPref, joined_at AS joinedAt, updated_at AS updatedAt FROM club_memberships WHERE club_id = ? AND user_id = ?").bind(second.id, secondOwner.id).first<ClubMembership>())!;
    const firstContext = context(first, firstMembership);
    const secondContext = context(second, secondMembership);
    const invitation = await createEmailInvitation(testEnv, secondContext, "boundary-invite@example.com");
    const { link } = await createInviteLink(testEnv, secondContext, {});

    await revokeEmailInvitation(testEnv, firstContext, invitation.id);
    await revokeInviteLink(testEnv, firstContext, link.id);
    await renameClubDisplayName(testEnv, firstContext, "Renamed first boundary club");
    await archiveClub(testEnv, firstContext);

    expect(await env.DB.prepare("SELECT status, name FROM clubs WHERE id = ?").bind(second.id).first()).toEqual({ status: "active", name: "Second boundary club" });
    expect(await env.DB.prepare("SELECT status FROM club_invitations WHERE id = ?").bind(invitation.id).first()).toEqual({ status: "pending" });
    expect(await env.DB.prepare("SELECT revoked_at FROM club_invite_links WHERE id = ?").bind(link.id).first()).toEqual({ revoked_at: null });
  });

  it("atomically reserves canonical and alias slugs and records one slug-change audit event", async () => {
    const owner = await user("club-slug-owner");
    const contender = await user("club-slug-contender");
    const club = await createClub(testEnv, owner, { name: "Slug club", slug: "slug-club" });
    const ownerMembership = (await env.DB.prepare("SELECT club_id AS clubId, user_id AS userId, role, onboarding_stage AS onboardingStage, model_pref AS modelPref, joined_at AS joinedAt, updated_at AS updatedAt FROM club_memberships WHERE club_id = ? AND user_id = ?").bind(club.id, owner.id).first<ClubMembership>())!;
    await renameClub(testEnv, context(club, ownerMembership), "renamed-slug-club");

    expect(await env.DB.prepare("SELECT slug FROM clubs WHERE id = ?").bind(club.id).first()).toEqual({ slug: "renamed-slug-club" });
    expect(await env.DB.prepare("SELECT club_id FROM club_slug_aliases WHERE slug = ?").bind("slug-club").first()).toEqual({ club_id: club.id });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE club_id = ? AND action = 'club.slug_changed'").bind(club.id).first()).toEqual({ count: 1 });
    for (const slug of ["slug-club", "renamed-slug-club"]) {
      expect((await response(() => createClub(testEnv, contender, { name: `Collision ${slug}`, slug }))).status).toBe(409);
    }
  });
});
