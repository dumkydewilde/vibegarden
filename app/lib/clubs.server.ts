import { and, eq } from "drizzle-orm";
import type { Club, ClubMembership, ClubRole, User } from "~/db/schema";
import { clubMemberships, clubs, clubSlugAliases } from "~/db/schema";
import { requireClubPermission } from "~/lib/club-permissions";
import { requireUser } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import { recordAuditEvent } from "~/lib/memberships.server";
import { serializeAuditMetadata } from "~/lib/operational-log.server";
import { normalizeClubSlug } from "~/lib/club-path";

export { normalizeClubSlug } from "~/lib/club-path";

export const RESERVED_CLUB_SLUGS = new Set([
  "admin",
  "api",
  "auth",
  "clubs",
  "dev",
  "join",
  "login",
  "logout",
  "settings",
]);

export function isValidClubSlug(value: string) {
  return (
    /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/.test(value) &&
    !RESERVED_CLUB_SLUGS.has(value)
  );
}

export type CreateClubInput = {
  name: string;
  slug: string;
};

export type ClubContext = {
  club: Club;
  membership: ClubMembership | null;
  effectiveRole: ClubRole;
  isSuperAdmin: boolean;
};

export type PlatformClubSummary = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  modelPolicy: "free_only" | "all_models";
  spendingLimitUsd: number | null;
  owner: { id: string; name: string | null; email: string } | null;
  memberCount: number;
  credentialState: "pending" | "ready" | "failed" | "disabled" | null;
  syncedPolicy: "free_only" | "all_models" | null;
  hasSyncDrift: boolean;
};

function notFound() {
  return new Response("Not found", { status: 404 });
}

function conflict() {
  return new Response("Conflict", { status: 409 });
}

function requirePlatformAdmin(user: User) {
  if (user.platformRole !== "super_admin") throw notFound();
}

function platformAudit(
  env: Env,
  actorUserId: string,
  clubId: string,
  action: string,
  metadata?: Record<string, unknown>,
) {
  return env.DB
    .prepare(
      "INSERT INTO audit_events (id, actor_user_id, club_id, action, target_type, target_id, metadata, created_at) SELECT ?, ?, ?, ?, 'club', ?, ?, ? WHERE changes() = 1",
    )
    .bind(
      crypto.randomUUID(),
      actorUserId,
      clubId,
      action,
      clubId,
      serializeAuditMetadata(action, metadata),
      Date.now(),
    );
}

export async function createClub(
  env: Env,
  user: User,
  input: CreateClubInput,
): Promise<Club> {
  const slug = normalizeClubSlug(input.slug);
  if (!isValidClubSlug(slug)) {
    throw new Response("Invalid club slug", { status: 400 });
  }

  const [claim, canonical, alias] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM club_slug_claims WHERE slug = ?").bind(slug).first(),
    env.DB.prepare("SELECT 1 FROM clubs WHERE slug = ?").bind(slug).first(),
    env.DB.prepare("SELECT 1 FROM club_slug_aliases WHERE slug = ?").bind(slug).first(),
  ]);
  if (claim || canonical || alias) {
    throw conflict();
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const club: Club = {
    id,
    name: input.name,
    slug,
    modelPolicy: "free_only",
    status: "active",
    spendingLimitUsd: null,
    spendingLimitReset: null,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };

  try {
    await env.DB.batch([
      env.DB
        .prepare(
          "INSERT INTO clubs (id, name, slug, model_policy, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          club.id,
          club.name,
          club.slug,
          club.modelPolicy,
          club.status,
          club.createdBy,
          club.createdAt,
          club.updatedAt,
        ),
      env.DB
        .prepare(
          "INSERT INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'owner', ?, ?)",
        )
        .bind(club.id, user.id, now, now),
      env.DB
        .prepare(
          "INSERT INTO club_ai_credentials (club_id, provisioning_state) VALUES (?, 'pending')",
        )
        .bind(club.id),
      env.DB
        .prepare("UPDATE users SET last_club_id = ? WHERE id = ?")
        .bind(club.id, user.id),
      recordAuditEvent(env, {
        actorUserId: user.id,
        clubId: club.id,
        action: "club.created",
        targetType: "club",
        targetId: club.id,
        createdAt: now,
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw conflict();
    }
    throw error;
  }

  return club;
}

/** Atomically reserves a new canonical slug and preserves the old URL alias. */
export async function renameClub(
  env: Env,
  context: ClubContext,
  rawSlug: string,
) {
  requireClubPermission(context, "manage_identity");
  const slug = normalizeClubSlug(rawSlug);
  if (!isValidClubSlug(slug)) {
    throw new Response("Invalid club slug", { status: 400 });
  }
  if (slug === context.club.slug) return slug;

  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB
        .prepare(
          "INSERT INTO club_slug_aliases (slug, club_id, created_at) VALUES (?, ?, ?)",
        )
        .bind(context.club.slug, context.club.id, now),
      env.DB
        .prepare("UPDATE clubs SET slug = ?, updated_at = ? WHERE id = ? AND slug = ?")
        .bind(slug, now, context.club.id, context.club.slug),
      recordAuditEvent(env, {
        actorUserId: context.membership?.userId ?? null,
        clubId: context.club.id,
        action: "club.slug_changed",
        targetType: "club",
        targetId: context.club.id,
        metadata: { previousSlug: context.club.slug, slug },
        createdAt: now,
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw conflict();
    }
    throw error;
  }
  return slug;
}

export async function renameClubDisplayName(
  env: Env,
  context: ClubContext,
  name: string,
) {
  requireClubPermission(context, "manage_identity");
  const value = name.trim().slice(0, 120);
  if (!value) throw new Response("Invalid club name", { status: 400 });
  await env.DB
    .prepare("UPDATE clubs SET name = ?, updated_at = ? WHERE id = ?")
    .bind(value, Date.now(), context.club.id)
    .run();
}

export async function listUserClubs(env: Env, userId: string) {
  return getDb(env)
    .select({ club: clubs, membership: clubMemberships })
    .from(clubMemberships)
    .innerJoin(clubs, eq(clubMemberships.clubId, clubs.id))
    .where(eq(clubMemberships.userId, userId));
}

/** Every active club a platform super admin can administer implicitly. */
export async function listActiveClubs(env: Env) {
  return getDb(env)
    .select()
    .from(clubs)
    .where(eq(clubs.status, "active"));
}

/** Lists platform-wide club state using grouped queries, never synthetic memberships. */
export async function listPlatformClubs(env: Env): Promise<PlatformClubSummary[]> {
  const [clubRows, memberRows] = await Promise.all([
    env.DB
      .prepare(
        `SELECT c.id, c.name, c.slug, c.status,
          c.model_policy AS modelPolicy, c.spending_limit_usd AS spendingLimitUsd,
          owner.id AS ownerId, owner.name AS ownerName, owner.email AS ownerEmail,
          credential.provisioning_state AS credentialState,
          credential.synced_policy AS syncedPolicy
        FROM clubs c
        LEFT JOIN club_memberships membership
          ON membership.club_id = c.id AND membership.role = 'owner'
        LEFT JOIN users owner ON owner.id = membership.user_id
        LEFT JOIN club_ai_credentials credential ON credential.club_id = c.id
        ORDER BY c.created_at DESC, c.id DESC`,
      )
      .all<{
        id: string;
        name: string;
        slug: string;
        status: "active" | "archived";
        modelPolicy: "free_only" | "all_models";
        spendingLimitUsd: number | null;
        ownerId: string | null;
        ownerName: string | null;
        ownerEmail: string | null;
        credentialState: PlatformClubSummary["credentialState"];
        syncedPolicy: PlatformClubSummary["syncedPolicy"];
      }>(),
    env.DB
      .prepare(
        "SELECT club_id AS clubId, COUNT(*) AS memberCount FROM club_memberships GROUP BY club_id",
      )
      .all<{ clubId: string; memberCount: number }>(),
  ]);
  const counts = new Map(memberRows.results.map((row) => [row.clubId, row.memberCount]));
  return clubRows.results.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    modelPolicy: row.modelPolicy,
    spendingLimitUsd: row.spendingLimitUsd,
    owner: row.ownerId && row.ownerEmail
      ? { id: row.ownerId, name: row.ownerName, email: row.ownerEmail }
      : null,
    memberCount: counts.get(row.id) ?? 0,
    credentialState: row.credentialState,
    syncedPolicy: row.syncedPolicy,
    hasSyncDrift: row.credentialState !== "ready" || row.syncedPolicy !== row.modelPolicy,
  }));
}

/** Changes the desired model policy and fails closed until it is reconciled remotely. */
export async function setClubModelPolicy(
  env: Env,
  superAdmin: User,
  clubId: string,
  modelPolicy: "free_only" | "all_models",
) {
  requirePlatformAdmin(superAdmin);
  if (modelPolicy !== "free_only" && modelPolicy !== "all_models") {
    throw new Response("Invalid model policy", { status: 400 });
  }
  const now = Date.now();
  const defaultSpendingLimitUsd = 5;
  const result = await env.DB.batch([
    env.DB
      .prepare(
        "UPDATE clubs SET model_policy = ?, spending_limit_usd = CASE WHEN ? = 'all_models' AND spending_limit_usd IS NULL THEN ? ELSE spending_limit_usd END, updated_at = ? WHERE id = ?",
      )
      .bind(modelPolicy, modelPolicy, defaultSpendingLimitUsd, now, clubId),
    env.DB
      .prepare(
        "UPDATE club_ai_credentials SET provisioning_state = 'pending', synced_policy = NULL, provisioning_lease_token = NULL, provisioning_lease_heartbeat_at = NULL WHERE club_id = ?",
      )
      .bind(clubId),
    platformAudit(env, superAdmin.id, clubId, "club.model_policy_changed", { modelPolicy }),
  ]);
  if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1) throw notFound();
}

/** Changes a platform-funded USD cap and leaves the credential unavailable until sync. */
export async function setClubSpendingLimit(
  env: Env,
  superAdmin: User,
  clubId: string,
  spendingLimitUsd: number | null,
) {
  requirePlatformAdmin(superAdmin);
  if (
    spendingLimitUsd !== null &&
    (!Number.isSafeInteger(spendingLimitUsd) || spendingLimitUsd < 0)
  ) {
    throw new Response("Invalid spending limit", { status: 400 });
  }
  const now = Date.now();
  const result = await env.DB.batch([
    env.DB
      .prepare("UPDATE clubs SET spending_limit_usd = ?, updated_at = ? WHERE id = ?")
      .bind(spendingLimitUsd, now, clubId),
    env.DB
      .prepare(
        "UPDATE club_ai_credentials SET provisioning_state = 'pending', synced_policy = NULL, provisioning_lease_token = NULL, provisioning_lease_heartbeat_at = NULL WHERE club_id = ?",
      )
      .bind(clubId),
    platformAudit(env, superAdmin.id, clubId, "club.spending_limit_changed", { spendingLimitUsd }),
  ]);
  if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1) throw notFound();
}

export async function requireClubContext(
  env: Env,
  request: Request,
  slug: string,
): Promise<ClubContext> {
  const user = await requireUser(env, request);
  const db = getDb(env);

  const [directClub] = await db
    .select()
    .from(clubs)
    .where(eq(clubs.slug, slug))
    .limit(1);

  const [aliasedClub] = directClub
    ? []
    : await db
        .select({ club: clubs })
        .from(clubSlugAliases)
        .innerJoin(clubs, eq(clubSlugAliases.clubId, clubs.id))
        .where(eq(clubSlugAliases.slug, slug))
        .limit(1);

  const club = directClub ?? aliasedClub?.club;
  if (!club || club.status === "archived") {
    throw notFound();
  }

  const [membership] = await db
    .select()
    .from(clubMemberships)
    .where(
      and(
        eq(clubMemberships.clubId, club.id),
        eq(clubMemberships.userId, user.id),
      ),
    )
    .limit(1);

  const isSuperAdmin = user.platformRole === "super_admin";
  if (!membership && !isSuperAdmin) {
    throw notFound();
  }

  if (aliasedClub) {
    const canonicalUrl = request.url.replace(
      `/clubs/${encodeURIComponent(slug)}`,
      `/clubs/${encodeURIComponent(club.slug)}`,
    );
    throw new Response(null, {
      status: 302,
      headers: { Location: canonicalUrl },
    });
  }

  return {
    club,
    membership: membership ?? null,
    effectiveRole: membership?.role ?? "admin",
    isSuperAdmin,
  };
}
