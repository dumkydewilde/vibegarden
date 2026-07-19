import { isValidEmail, normalizeEmail } from "./otp.server";
import type { ClubInvitation, ClubInviteLink, User } from "~/db/schema";
import type { ClubContext } from "~/lib/clubs.server";
import { requireClubPermission } from "~/lib/club-permissions";

export type RejectedInvite = {
  value: string;
  reason: "Invalid email address";
};

export type BulkInviteParseResult = {
  accepted: string[];
  duplicates: string[];
  rejected: RejectedInvite[];
};

function unquote(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

export function parseBulkInviteInput(
  sources: string[],
): BulkInviteParseResult {
  const accepted: string[] = [];
  const duplicates: string[] = [];
  const rejected: RejectedInvite[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const rawValue of source.split(/[\r\n,;]+/)) {
      const value = unquote(rawValue);
      if (!value || value.toLowerCase() === "email") continue;

      const email = normalizeEmail(value);
      if (seen.has(email)) {
        duplicates.push(email);
        continue;
      }
      seen.add(email);

      if (!isValidEmail(email)) {
        rejected.push({ value, reason: "Invalid email address" });
        continue;
      }
      accepted.push(email);
    }
  }

  return { accepted, duplicates, rejected };
}

const UPSERT_INVITE_SQL = `
  INSERT INTO invites (email, invited_by, status, created_at)
  VALUES (?, ?, 'pending', ?)
  ON CONFLICT(email) DO UPDATE SET
    invited_by = CASE
      WHEN invites.status = 'joined' THEN invites.invited_by
      ELSE excluded.invited_by
    END,
    status = CASE
      WHEN invites.status = 'joined' THEN 'joined'
      ELSE 'pending'
    END
`;

export async function saveBulkInvites(
  db: D1Database,
  emails: string[],
  invitedBy: string,
  now = Date.now(),
) {
  if (emails.length === 0) return;

  const statements = emails.map((email) =>
    db.prepare(UPSERT_INVITE_SQL).bind(email, invitedBy, now),
  );
  await db.batch(statements);
}

export type BulkInviteImportResult = BulkInviteParseResult & {
  imported: number;
};

export async function importBulkInvites(
  db: D1Database,
  form: FormData,
  invitedBy: string,
  now = Date.now(),
): Promise<BulkInviteImportResult> {
  const sources = [String(form.get("emails") ?? "")];
  const file = form.get("inviteFile");
  if (file && typeof file !== "string" && file.size > 0) {
    sources.push(await file.text());
  }

  const parsed = parseBulkInviteInput(sources);
  await saveBulkInvites(db, parsed.accepted, invitedBy, now);
  return { ...parsed, imported: parsed.accepted.length };
}

function invalidEmail() {
  return new Response("Invalid email address", { status: 400 });
}

async function invitationByClubAndEmail(
  env: Env,
  clubId: string,
  email: string,
): Promise<ClubInvitation> {
  const invitation = await env.DB.prepare(
    `SELECT id, club_id AS clubId, email, status, invited_by AS invitedBy,
            created_at AS createdAt, updated_at AS updatedAt,
            accepted_at AS acceptedAt
       FROM club_invitations
      WHERE club_id = ? AND email = ?`,
  )
    .bind(clubId, email)
    .first<ClubInvitation>();
  if (!invitation) throw new Error("Invitation was not created");
  return invitation;
}

/**
 * Creates a club-scoped email invitation. Existing global users join the
 * current club immediately; everyone else joins after verifying this email.
 */
export async function createEmailInvitation(
  env: Env,
  context: ClubContext,
  rawEmail: string,
): Promise<ClubInvitation> {
  requireClubPermission(context, "manage_invites");
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw invalidEmail();

  const now = Date.now();
  const invitationId = crypto.randomUUID();
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();
  const statements: D1PreparedStatement[] = [
    env.DB
      .prepare(
        `INSERT INTO club_invitations (
           id, club_id, email, status, invited_by, created_at, updated_at
         ) VALUES (?, ?, ?, 'pending', ?, ?, ?)
         ON CONFLICT(club_id, email) DO UPDATE SET
           invited_by = CASE
             WHEN club_invitations.status = 'joined' THEN club_invitations.invited_by
             ELSE excluded.invited_by
           END,
           status = CASE
             WHEN club_invitations.status = 'joined' THEN 'joined'
             ELSE 'pending'
           END,
           updated_at = excluded.updated_at`,
      )
      .bind(invitationId, context.club.id, email, context.membership?.userId ?? null, now, now),
  ];

  if (user) {
    statements.push(
      env.DB
        .prepare(
          "INSERT OR IGNORE INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
        )
        .bind(context.club.id, user.id, now, now),
      env.DB
        .prepare(
          `UPDATE club_invitations
              SET status = 'joined', accepted_at = COALESCE(accepted_at, ?), updated_at = ?
            WHERE club_id = ? AND email = ?`,
        )
        .bind(now, now, context.club.id, email),
    );
  }

  await env.DB.batch(statements);
  return invitationByClubAndEmail(env, context.club.id, email);
}

export async function revokeEmailInvitation(
  env: Env,
  context: ClubContext,
  invitationId: string,
) {
  requireClubPermission(context, "manage_invites");
  await env.DB
    .prepare(
      "UPDATE club_invitations SET status = 'revoked', updated_at = ? WHERE id = ? AND club_id = ? AND status = 'pending'",
    )
    .bind(Date.now(), invitationId, context.club.id)
    .run();
}

/** Accept every active-club invitation for this verified global account. */
export async function acceptPendingEmailInvitations(env: Env, user: User) {
  const pending = await env.DB
    .prepare(
      `SELECT invitation.id, invitation.club_id AS clubId
         FROM club_invitations invitation
         INNER JOIN clubs club ON club.id = invitation.club_id
        WHERE invitation.email = ?
          AND invitation.status = 'pending'
          AND club.status = 'active'`,
    )
    .bind(normalizeEmail(user.email))
    .all<{ id: string; clubId: string }>();
  if (pending.results.length === 0) return;

  const now = Date.now();
  const statements = pending.results.flatMap((invitation) => [
    env.DB
      .prepare(
        "INSERT OR IGNORE INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
      )
      .bind(invitation.clubId, user.id, now, now),
    env.DB
      .prepare(
        "UPDATE club_invitations SET status = 'joined', accepted_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      )
      .bind(now, now, invitation.id),
  ]);
  await env.DB.batch(statements);
}

export type InviteLinkExpiry = "1h" | "24h" | "7d" | "30d";

export type CreateInviteLinkInput = {
  expiresIn?: InviteLinkExpiry | null;
  maxJoins?: number | null;
};

const expiryDurations: Record<InviteLinkExpiry, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function generateInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function hashInviteToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createInviteLink(
  env: Env,
  context: ClubContext,
  input: CreateInviteLinkInput,
): Promise<{ urlToken: string; link: ClubInviteLink }> {
  requireClubPermission(context, "manage_invites");
  if (
    input.maxJoins !== undefined &&
    input.maxJoins !== null &&
    (!Number.isInteger(input.maxJoins) || input.maxJoins < 1)
  ) {
    throw new Response("Invalid maximum joins", { status: 400 });
  }
  if (input.expiresIn && !(input.expiresIn in expiryDurations)) {
    throw new Response("Invalid invitation expiry", { status: 400 });
  }

  const now = Date.now();
  const urlToken = generateInviteToken();
  const link: ClubInviteLink = {
    id: crypto.randomUUID(),
    clubId: context.club.id,
    tokenHash: await hashInviteToken(urlToken),
    createdBy: context.membership?.userId ?? null,
    createdAt: now,
    expiresAt: input.expiresIn ? now + expiryDurations[input.expiresIn] : null,
    maxJoins: input.maxJoins ?? null,
    currentJoins: 0,
    revokedAt: null,
  };
  await env.DB
    .prepare(
      `INSERT INTO club_invite_links (
        id, club_id, token_hash, created_by, created_at, expires_at,
        max_joins, current_joins, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      link.id,
      link.clubId,
      link.tokenHash,
      link.createdBy,
      link.createdAt,
      link.expiresAt,
      link.maxJoins,
      link.currentJoins,
      link.revokedAt,
    )
    .run();
  return { urlToken, link };
}

export async function revokeInviteLink(
  env: Env,
  context: ClubContext,
  linkId: string,
) {
  requireClubPermission(context, "manage_invites");
  await env.DB
    .prepare(
      "UPDATE club_invite_links SET revoked_at = ? WHERE id = ? AND club_id = ? AND revoked_at IS NULL",
    )
    .bind(Date.now(), linkId, context.club.id)
    .run();
}

type AvailableInviteLink = {
  id: string;
  clubId: string;
  clubSlug: string;
  clubName: string;
  expiresAt: number | null;
  maxJoins: number | null;
  currentJoins: number;
  revokedAt: number | null;
};

async function availableInviteLink(env: Env, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await hashInviteToken(token);
  const link = await env.DB
    .prepare(
      `SELECT link.id, link.club_id AS clubId, club.slug AS clubSlug,
              club.name AS clubName,
              link.expires_at AS expiresAt, link.max_joins AS maxJoins,
              link.current_joins AS currentJoins, link.revoked_at AS revokedAt
         FROM club_invite_links link
         INNER JOIN clubs club ON club.id = link.club_id
        WHERE link.token_hash = ? AND club.status = 'active'`,
    )
    .bind(tokenHash)
    .first<AvailableInviteLink>();
  if (
    !link ||
    link.revokedAt !== null ||
    (link.expiresAt !== null && link.expiresAt <= Date.now()) ||
    (link.maxJoins !== null && link.currentJoins >= link.maxJoins)
  ) {
    return null;
  }
  return link;
}

export type InvitePreview =
  | { clubName: string; available: true }
  | { clubName: null; available: false };

/** This lookup intentionally has no side effects; joining is an explicit POST. */
export async function getInvitePreview(
  env: Env,
  token: string,
): Promise<InvitePreview> {
  const link = await availableInviteLink(env, token);
  return link
    ? { clubName: link.clubName, available: true }
    : { clubName: null, available: false };
}

export type JoinWithInviteLinkResult =
  | { ok: true; clubSlug: string }
  | { ok: false };

/**
 * Consume one link slot and create membership in one D1 transaction. A normal
 * insert deliberately makes a duplicate race roll back the counter increment.
 */
export async function joinWithInviteLink(
  env: Env,
  user: User,
  token: string,
): Promise<JoinWithInviteLinkResult> {
  const link = await availableInviteLink(env, token);
  if (!link) return { ok: false };

  const existing = await env.DB
    .prepare(
      "SELECT 1 AS member FROM club_memberships WHERE club_id = ? AND user_id = ?",
    )
    .bind(link.clubId, user.id)
    .first();
  if (existing) return { ok: true, clubSlug: link.clubSlug };

  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE club_invite_links
              SET current_joins = current_joins + 1
            WHERE id = ?
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > ?)
              AND (max_joins IS NULL OR current_joins < max_joins)
              AND EXISTS (
                SELECT 1 FROM clubs WHERE clubs.id = club_invite_links.club_id AND clubs.status = 'active'
              )`,
        )
        .bind(link.id, now),
      env.DB
        .prepare(
          `INSERT INTO club_memberships (
             club_id, user_id, role, joined_at, updated_at
           ) SELECT ?, ?, 'member', ?, ? WHERE changes() = 1`,
        )
        .bind(link.clubId, user.id, now, now),
      env.DB
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, club_id, action, target_type, target_id, created_at
           ) SELECT ?, ?, ?, 'membership.joined_via_link', 'membership', ?, ?
             WHERE changes() = 1`,
        )
        .bind(crypto.randomUUID(), user.id, link.clubId, user.id, now),
    ]);
  } catch (error) {
    if (!(error instanceof Error) || !/UNIQUE constraint failed/i.test(error.message)) {
      throw error;
    }
    const membership = await env.DB
      .prepare(
        "SELECT 1 AS member FROM club_memberships WHERE club_id = ? AND user_id = ?",
      )
      .bind(link.clubId, user.id)
      .first();
    return membership
      ? { ok: true, clubSlug: link.clubSlug }
      : { ok: false };
  }

  const membership = await env.DB
    .prepare(
      "SELECT 1 AS member FROM club_memberships WHERE club_id = ? AND user_id = ?",
    )
    .bind(link.clubId, user.id)
    .first();
  return membership
    ? { ok: true, clubSlug: link.clubSlug }
    : { ok: false };
}
