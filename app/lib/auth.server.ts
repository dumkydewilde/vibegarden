import { redirect } from "react-router";
import { eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { sessions, users, type User } from "~/db/schema";

const COOKIE_NAME = "vg_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** `value` -> `value.<hmac-hex>` */
export async function signValue(value: string, secret: string) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return `${value}.${toHex(sig)}`;
}

/** Returns the original value, or null if the signature does not check out. */
export async function verifyValue(signed: string, secret: string) {
  const dot = signed.lastIndexOf(".");
  if (dot < 1) return null;
  const value = signed.slice(0, dot);
  const sigHex = signed.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sigHex)) return null;
  const key = await hmacKey(secret);
  const sig = Uint8Array.from(
    sigHex.match(/../g)!.map((b) => parseInt(b, 16)),
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sig,
    encoder.encode(value),
  );
  return ok ? value : null;
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ?? null;
}

function isSecure(request: Request) {
  return new URL(request.url).protocol === "https:";
}

export async function createSessionCookie(env: Env, request: Request, userId: string) {
  const db = getDb(env);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(sessions).values({
    id,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  const signed = await signValue(id, env.SESSION_SECRET);
  const secure = isSecure(request) ? "; Secure" : "";
  return `${COOKIE_NAME}=${signed}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export async function destroySessionCookie(env: Env, request: Request) {
  const signed = cookieValue(request, COOKIE_NAME);
  if (signed) {
    const id = await verifyValue(decodeURIComponent(signed), env.SESSION_SECRET);
    if (id) {
      await getDb(env).delete(sessions).where(eq(sessions.id, id));
    }
  }
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getUser(env: Env, request: Request): Promise<User | null> {
  const signed = cookieValue(request, COOKIE_NAME);
  if (!signed) return null;
  const id = await verifyValue(decodeURIComponent(signed), env.SESSION_SECRET);
  if (!id) return null;

  const db = getDb(env);
  const rows = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return row.user;
}

export async function requireUser(env: Env, request: Request): Promise<User> {
  const user = await getUser(env, request);
  if (!user) {
    const to = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(to.pathname)}`);
  }
  return user;
}

export async function requireAdmin(env: Env, request: Request): Promise<User> {
  const user = await requireUser(env, request);
  if (user.role !== "admin") {
    throw new Response("Not found", { status: 404 });
  }
  return user;
}
