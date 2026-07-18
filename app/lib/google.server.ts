import { signValue, verifyValue } from "./auth.server";

const STATE_COOKIE = "vg_oauth_state";

export function googleEnabled(env: Env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function callbackUrl(request: Request) {
  const url = new URL(request.url);
  return `${url.origin}/auth/google/callback`;
}

function safeNextPath(request: Request, value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  const current = new URL(request.url);
  const destination = new URL(value, current);
  if (destination.origin !== current.origin) return "/";
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function nextPath(request: Request) {
  const url = new URL(request.url);
  const explicit = url.searchParams.get("next");
  if (explicit) return safeNextPath(request, explicit);

  const referer = request.headers.get("Referer");
  if (!referer) return "/";
  try {
    const source = new URL(referer);
    if (source.origin !== url.origin || source.pathname !== "/login") return "/";
    return safeNextPath(request, source.searchParams.get("next"));
  } catch {
    return "/";
  }
}

/** Builds the Google consent URL plus the state cookie to set. */
export async function googleAuthRedirect(
  env: Env,
  request: Request,
  next?: string | null,
) {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: callbackUrl(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  const signed = await signValue(
    JSON.stringify({
      state,
      next: next === undefined ? nextPath(request) : safeNextPath(request, next),
    }),
    env.SESSION_SECRET,
  );
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    stateCookie: `${STATE_COOKIE}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
  };
}

export type GoogleCallbackResult =
  | { ok: true; email: string; name: string | null; next: string }
  | { ok: false; error: string };

export async function handleGoogleCallback(
  env: Env,
  request: Request,
): Promise<GoogleCallbackResult> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return { ok: false, error: "missing-params" };

  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`));
  const stored = match
    ? await verifyValue(decodeURIComponent(match[1]), env.SESSION_SECRET)
    : null;
  if (!stored) return { ok: false, error: "bad-state" };
  let storedState: { state?: string; next?: string };
  try {
    storedState = JSON.parse(stored) as { state?: string; next?: string };
  } catch {
    return { ok: false, error: "bad-state" };
  }
  if (storedState.state !== state) return { ok: false, error: "bad-state" };

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl(request),
    }),
  });
  if (!tokenRes.ok) return { ok: false, error: "token-exchange-failed" };
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) return { ok: false, error: "no-access-token" };

  const infoRes = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  if (!infoRes.ok) return { ok: false, error: "userinfo-failed" };
  const info = (await infoRes.json()) as {
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!info.email || info.email_verified === false) {
    return { ok: false, error: "no-verified-email" };
  }
  return {
    ok: true,
    email: info.email,
    name: info.name ?? null,
    next: safeNextPath(request, storedState.next ?? null),
  };
}
