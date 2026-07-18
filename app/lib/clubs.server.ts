import { and, eq } from "drizzle-orm";
import type { Club, ClubMembership, ClubRole, User } from "~/db/schema";
import { clubMemberships, clubs, clubSlugAliases } from "~/db/schema";
import { requireUser } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import { recordAuditEvent } from "~/lib/memberships.server";
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

function notFound() {
  return new Response("Not found", { status: 404 });
}

function conflict() {
  return new Response("Conflict", { status: 409 });
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

  const [canonical, alias] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM clubs WHERE slug = ?").bind(slug).first(),
    env.DB
      .prepare("SELECT 1 FROM club_slug_aliases WHERE slug = ?")
      .bind(slug)
      .first(),
  ]);
  if (canonical || alias) {
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
