import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { cloudflareContext } from "~/lib/context";
import { destroySessionCookie } from "~/lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const cookie = await destroySessionCookie(context.get(cloudflareContext).env, request);
  return redirect("/login", { headers: { "Set-Cookie": cookie } });
}

export async function loader() {
  return redirect("/");
}
