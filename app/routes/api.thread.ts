import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/api.thread";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import { newThread, touchThread } from "~/lib/threads.server";
import { projects } from "~/db/schema";

/**
 * POST with no body: start a fresh conversation.
 * POST with {threadId}: make that thread the active one again (continue).
 * POST with {projectId}: fresh conversation linked to that project.
 * Old threads always stay in the database.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);

  let threadId: string | undefined;
  let projectId: string | undefined;
  try {
    const body = (await request.json()) as {
      threadId?: string;
      projectId?: string;
    };
    if (typeof body?.threadId === "string") threadId = body.threadId;
    if (typeof body?.projectId === "string") projectId = body.projectId;
  } catch {
    // No JSON body: fresh conversation.
  }

  if (threadId) {
    await touchThread(env, user.id, threadId);
    return Response.json({ ok: true, threadId });
  }

  const thread = await newThread(env, user.id, projectId);
  if (projectId) {
    await getDb(env)
      .update(projects)
      .set({ threadId: thread.id, updatedAt: Date.now() })
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));
  }
  return Response.json({ ok: true, threadId: thread.id });
}
