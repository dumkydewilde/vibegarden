import { eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { acceptPendingEmailInvitations } from "./invites.server";
import { sendOtpEmail } from "./mailer.server";
import { otpCodes, users, type User } from "~/db/schema";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function generateCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

/** Constant-time-ish comparison for short codes. */
export function codesMatch(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAdminEmail(env: Env, email: string) {
  return normalizeEmail(env.ADMIN_EMAIL ?? "") === normalizeEmail(email);
}

export async function isEmailAllowedToLogin(env: Env, email: string) {
  if (isAdminEmail(env, email)) return true;
  const admission = await env.DB
    .prepare(
      `SELECT 1 AS allowed
         FROM users
        WHERE email = ?
        UNION ALL
       SELECT 1 AS allowed
         FROM club_invitations
        WHERE email = ? AND status != 'revoked'
        LIMIT 1`,
    )
    .bind(email, email)
    .first();
  return Boolean(admission);
}

export type RequestCodeResult =
  | { ok: true; sent: boolean; devCode?: string }
  | { ok: false; error: "invalid-email" | "not-invited" };

export async function requestLoginCode(
  env: Env,
  rawEmail: string,
): Promise<RequestCodeResult> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: "invalid-email" };
  if (!(await isEmailAllowedToLogin(env, email))) {
    return { ok: false, error: "not-invited" };
  }

  const code = generateCode();
  const now = Date.now();
  const db = getDb(env);
  await db
    .insert(otpCodes)
    .values({ email, code, expiresAt: now + OTP_TTL_MS, attempts: 0, createdAt: now })
    .onConflictDoUpdate({
      target: otpCodes.email,
      set: { code, expiresAt: now + OTP_TTL_MS, attempts: 0, createdAt: now },
    });

  const sent = await sendOtpEmail(env, email, code);
  return { ok: true, sent, devCode: sent ? undefined : code };
}

export type VerifyCodeResult =
  | { ok: true; user: User }
  | { ok: false; error: "invalid" | "expired" | "too-many-attempts" };

export async function verifyLoginCode(
  env: Env,
  rawEmail: string,
  code: string,
): Promise<VerifyCodeResult> {
  const email = normalizeEmail(rawEmail);
  const db = getDb(env);
  const row = await db.query.otpCodes.findFirst({
    where: eq(otpCodes.email, email),
  });
  if (!row) return { ok: false, error: "invalid" };
  if (row.expiresAt < Date.now()) {
    await db.delete(otpCodes).where(eq(otpCodes.email, email));
    return { ok: false, error: "expired" };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "too-many-attempts" };
  }
  if (!codesMatch(row.code, code.trim())) {
    await db
      .update(otpCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(otpCodes.email, email));
    return { ok: false, error: "invalid" };
  }

  await db.delete(otpCodes).where(eq(otpCodes.email, email));
  const user = await upsertUser(env, email);
  await acceptPendingEmailInvitations(env, user);
  return { ok: true, user };
}

/**
 * Creates the global identity on first login. When specified, the forced
 * legacy role also clears platform-admin access for the isolated reviewer.
 */
export async function upsertUser(
  env: Env,
  email: string,
  forcedRole?: User["role"],
  forcedId?: string,
): Promise<User | null> {
  const db = getDb(env);
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    if (forcedId && existing.id !== forcedId) {
      return null;
    }
    if (
      forcedRole
      && (existing.role !== forcedRole || existing.platformRole !== "user")
    ) {
      await db
        .update(users)
        .set({ role: forcedRole, platformRole: "user" })
        .where(eq(users.id, existing.id));
      return { ...existing, role: forcedRole, platformRole: "user" };
    }
    return existing;
  }

  const user = {
    id: forcedId ?? crypto.randomUUID(),
    email,
    name: null,
    role: forcedRole ?? (isAdminEmail(env, email) ? ("admin" as const) : ("user" as const)),
    stage: "invited" as const,
    modelPref: null,
    platformRole: "user" as const,
    themePref: null,
    lastClubId: null,
    createdAt: Date.now(),
  };
  await db.insert(users).values(user);
  return user;
}
