import type { Route } from "./+types/api.thread";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { newThread } from "~/lib/threads.server";

/** POST: start a fresh conversation (the old one stays in the database). */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  await newThread(env, user.id);
  return Response.json({ ok: true });
}
