import { redirect } from "react-router";
import type { Route } from "./+types/auth.google";
import { cloudflareContext } from "~/lib/context";
import { googleAuthRedirect, googleEnabled } from "~/lib/google.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  if (!googleEnabled(env)) throw redirect("/login");
  const { url, stateCookie } = await googleAuthRedirect(env, request);
  return redirect(url, { headers: { "Set-Cookie": stateCookie } });
}
