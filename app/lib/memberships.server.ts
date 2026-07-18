import type { ClubRole, User } from "~/db/schema";
import { requireClubPermission } from "~/lib/club-permissions";
import type { ClubContext } from "~/lib/clubs.server";

type AuditEventInput = {
  actorUserId: string | null;
  clubId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

function conflict() {
  return new Response("Conflict", { status: 409 });
}

function notFound() {
  return new Response("Not found", { status: 404 });
}

function badRequest() {
  return new Response("Invalid membership role", { status: 400 });
}

function explicitMembership(context: ClubContext) {
  if (!context.membership) {
    throw notFound();
  }
  return context.membership;
}

export function recordAuditEvent(env: Env, event: AuditEventInput) {
  return env.DB
    .prepare(
      "INSERT INTO audit_events (id, actor_user_id, club_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      event.actorUserId,
      event.clubId,
      event.action,
      event.targetType,
      event.targetId,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.createdAt,
    );
}

async function runConditionalMutation(
  env: Env,
  mutation: D1PreparedStatement,
  auditEvent: AuditEventInput,
  expectedChanges = 1,
) {
  const result = await env.DB.batch([
    mutation,
    env.DB
      .prepare(
        "INSERT INTO audit_events (id, actor_user_id, club_id, action, target_type, target_id, metadata, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = ?",
      )
      .bind(
        crypto.randomUUID(),
        auditEvent.actorUserId,
        auditEvent.clubId,
        auditEvent.action,
        auditEvent.targetType,
        auditEvent.targetId,
        auditEvent.metadata ? JSON.stringify(auditEvent.metadata) : null,
        auditEvent.createdAt,
        expectedChanges,
      ),
  ]);
  return result[0].meta.changes;
}

export async function leaveClub(env: Env, context: ClubContext) {
  const member = explicitMembership(context);
  const now = Date.now();
  const changes = await runConditionalMutation(
    env,
    env.DB
      .prepare(
        "DELETE FROM club_memberships WHERE club_id = ? AND user_id = ? AND (role != 'owner' OR (SELECT COUNT(*) FROM club_memberships owners WHERE owners.club_id = club_memberships.club_id AND owners.role = 'owner') > 1)",
      )
      .bind(context.club.id, member.userId),
    {
      actorUserId: member.userId,
      clubId: context.club.id,
      action: "member.left",
      targetType: "membership",
      targetId: member.userId,
      createdAt: now,
    },
  );
  if (changes === 0) throw conflict();
}

export async function removeMember(
  env: Env,
  context: ClubContext,
  userId: string,
) {
  const actor = explicitMembership(context);
  requireClubPermission(context, "manage_member");
  const now = Date.now();
  const changes = await runConditionalMutation(
    env,
    env.DB
      .prepare(
        "DELETE FROM club_memberships WHERE club_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM club_memberships actor WHERE actor.club_id = club_memberships.club_id AND actor.user_id = ? AND (actor.role = 'owner' OR (actor.role = 'admin' AND club_memberships.role = 'member'))) AND (role != 'owner' OR (SELECT COUNT(*) FROM club_memberships owners WHERE owners.club_id = club_memberships.club_id AND owners.role = 'owner') > 1)",
      )
      .bind(context.club.id, userId, actor.userId),
    {
      actorUserId: actor.userId,
      clubId: context.club.id,
      action: "member.removed",
      targetType: "membership",
      targetId: userId,
      createdAt: now,
    },
  );
  if (changes === 0) {
    if (context.effectiveRole === "admin") throw notFound();
    throw conflict();
  }
}

export async function changeMemberRole(
  env: Env,
  context: ClubContext,
  userId: string,
  role: ClubRole,
) {
  const actor = explicitMembership(context);
  requireClubPermission(context, "manage_admin");
  if (role !== "admin" && role !== "member") throw badRequest();
  const now = Date.now();
  const changes = await runConditionalMutation(
    env,
    env.DB
      .prepare(
        "UPDATE club_memberships SET role = ?, updated_at = ? WHERE club_id = ? AND user_id = ? AND role != ? AND EXISTS (SELECT 1 FROM club_memberships actor WHERE actor.club_id = club_memberships.club_id AND actor.user_id = ? AND actor.role = 'owner') AND (role != 'owner' OR (SELECT COUNT(*) FROM club_memberships owners WHERE owners.club_id = club_memberships.club_id AND owners.role = 'owner') > 1)",
      )
      .bind(role, now, context.club.id, userId, role, actor.userId),
    {
      actorUserId: actor.userId,
      clubId: context.club.id,
      action: "member.role_changed",
      targetType: "membership",
      targetId: userId,
      metadata: { role },
      createdAt: now,
    },
  );
  if (changes === 0) throw conflict();
}

export async function transferOwnership(
  env: Env,
  context: ClubContext,
  newOwnerId: string,
) {
  const currentOwner = explicitMembership(context);
  requireClubPermission(context, "transfer_ownership");
  if (currentOwner.role !== "owner") throw conflict();
  const now = Date.now();
  const changes = await runConditionalMutation(
    env,
    env.DB
      .prepare(
        `UPDATE club_memberships
SET role = CASE
  WHEN user_id = ? THEN 'owner'
  WHEN user_id = ? THEN 'admin'
  ELSE role
END,
updated_at = ?
WHERE club_id = ?
  AND user_id IN (?, ?)
  AND EXISTS (
    SELECT 1 FROM club_memberships current_owner
    WHERE current_owner.club_id = club_memberships.club_id
      AND current_owner.user_id = ?
      AND current_owner.role = 'owner'
  )
  AND EXISTS (
    SELECT 1 FROM club_memberships target
    WHERE target.club_id = club_memberships.club_id
      AND target.user_id = ?
      AND target.role != 'owner'
  );`,
      )
      .bind(
        newOwnerId,
        currentOwner.userId,
        now,
        context.club.id,
        newOwnerId,
        currentOwner.userId,
        currentOwner.userId,
        newOwnerId,
      ),
    {
      actorUserId: currentOwner.userId,
      clubId: context.club.id,
      action: "ownership.transferred",
      targetType: "membership",
      targetId: newOwnerId,
      metadata: { previousOwnerId: currentOwner.userId },
      createdAt: now,
    },
    2,
  );
  if (changes !== 2) throw conflict();
}

export async function archiveClub(env: Env, context: ClubContext) {
  const actor = explicitMembership(context);
  requireClubPermission(context, "archive");
  const now = Date.now();
  const changes = await runConditionalMutation(
    env,
    env.DB
      .prepare(
        "UPDATE clubs SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ? AND status = 'active' AND EXISTS (SELECT 1 FROM club_memberships actor WHERE actor.club_id = clubs.id AND actor.user_id = ? AND actor.role = 'owner')",
      )
      .bind(now, now, context.club.id, actor.userId),
    {
      actorUserId: actor.userId,
      clubId: context.club.id,
      action: "club.archived",
      targetType: "club",
      targetId: context.club.id,
      createdAt: now,
    },
  );
  if (changes === 0) throw conflict();
}

export async function restoreClub(env: Env, superAdmin: User, clubId: string) {
  if (superAdmin.platformRole !== "super_admin") throw notFound();
  const now = Date.now();
  const changes = await runConditionalMutation(
    env,
    env.DB
      .prepare(
        "UPDATE clubs SET status = 'active', archived_at = NULL, updated_at = ? WHERE id = ? AND status = 'archived'",
      )
      .bind(now, clubId),
    {
      actorUserId: superAdmin.id,
      clubId,
      action: "club.restored",
      targetType: "club",
      targetId: clubId,
      createdAt: now,
    },
  );
  if (changes === 0) throw conflict();
}
