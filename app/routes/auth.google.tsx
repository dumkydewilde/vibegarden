import { redirect } from "react-router";
import type { Route } from "./+types/auth.google";
import { cloudflareContext } from "~/lib/context";
import { googleAuthRedirect, googleEnabled } from "~/lib/google.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  if (!googleEnabled(env)) throw redirect("/login");
  const next = new URL(request.url).searchParams.get("next");
  const { url, stateCookie } = await googleAuthRedirect(
    env,
    request,
    next ?? undefined,
  );
  return redirect(url, { headers: { "Set-Cookie": stateCookie } });
}
