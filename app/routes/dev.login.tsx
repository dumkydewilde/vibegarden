import { redirect } from "react-router";
import type { Route } from "./+types/dev.login";
import { cloudflareContext } from "~/lib/context";
import { createSessionCookie } from "~/lib/auth.server";
import { upsertUser } from "~/lib/otp.server";

function safeNext(request: Request) {
  const current = new URL(request.url);
  const next = current.searchParams.get("next");
  if (!next?.startsWith("/") || next.startsWith("//")) return "/";

  const destination = new URL(next, current);
  if (destination.origin !== current.origin) return "/";
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (
    !env.DEV_LOGIN_TOKEN ||
    !env.ADMIN_EMAIL ||
    !token ||
    token !== env.DEV_LOGIN_TOKEN
  ) {
    throw new Response("Not found", { status: 404 });
  }

  const user = await upsertUser(env, env.ADMIN_EMAIL);
  const cookie = await createSessionCookie(env, request, user.id);
  throw redirect(safeNext(request), { headers: { "Set-Cookie": cookie } });
}
