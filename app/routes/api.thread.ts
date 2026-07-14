import type { Route } from "./+types/api.thread";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { newThread, touchThread } from "~/lib/threads.server";

/**
 * POST with no body: start a fresh conversation.
 * POST with {threadId}: make that thread the active one again (continue).
 * Old threads always stay in the database.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);

  let threadId: string | undefined;
  try {
    const body = (await request.json()) as { threadId?: string };
    if (typeof body?.threadId === "string") threadId = body.threadId;
  } catch {
    // No JSON body: fresh conversation.
  }

  if (threadId) {
    await touchThread(env, user.id, threadId);
  } else {
    await newThread(env, user.id);
  }
  return Response.json({ ok: true });
}
