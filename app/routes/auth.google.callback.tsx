import { redirect } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/auth.google.callback";
import { cloudflareContext } from "~/lib/context";
import { createSessionCookie } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import { googleEnabled, handleGoogleCallback } from "~/lib/google.server";
import { isAdminEmail, normalizeEmail, upsertUser } from "~/lib/otp.server";
import { invites, users } from "~/db/schema";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  if (!googleEnabled(env)) throw redirect("/login");

  const result = await handleGoogleCallback(env, request);
  if (!result.ok) throw redirect(`/login?error=${result.error}`);

  const email = normalizeEmail(result.email);
  const db = getDb(env);
  const invite = await db.query.invites.findFirst({
    where: eq(invites.email, email),
  });
  const allowed =
    isAdminEmail(env, email) || (invite && invite.status !== "revoked");
  if (!allowed) throw redirect("/login?error=not-invited");

  const user = await upsertUser(env, email);
  if (result.name && !user.name) {
    await db
      .update(users)
      .set({ name: result.name })
      .where(eq(users.id, user.id));
  }
  const cookie = await createSessionCookie(env, request, user.id);
  return redirect("/", { headers: { "Set-Cookie": cookie } });
}
