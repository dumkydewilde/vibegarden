import { desc, eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { normalizeFeedbackBody, type FeedbackStatus } from "./feedback";
import { siteFeedback, users, type SiteFeedback } from "~/db/schema";

export async function submitFeedback(
  env: Env,
  userId: string,
  input: { page?: string | null; body: string },
): Promise<SiteFeedback | null> {
  const body = normalizeFeedbackBody(input.body);
  if (!body) return null;
  const row: SiteFeedback = {
    id: crypto.randomUUID(),
    userId,
    page: input.page?.slice(0, 200) ?? null,
    body,
    status: "new",
    createdAt: Date.now(),
  };
  await getDb(env).insert(siteFeedback).values(row);
  return row;
}

/** All feedback with author details, newest first. Admin-only. */
export async function listFeedback(env: Env) {
  return getDb(env)
    .select({
      id: siteFeedback.id,
      page: siteFeedback.page,
      body: siteFeedback.body,
      status: siteFeedback.status,
      createdAt: siteFeedback.createdAt,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(siteFeedback)
    .innerJoin(users, eq(users.id, siteFeedback.userId))
    .orderBy(desc(siteFeedback.createdAt));
}

export async function setFeedbackStatus(
  env: Env,
  id: string,
  status: FeedbackStatus,
) {
  await getDb(env)
    .update(siteFeedback)
    .set({ status })
    .where(eq(siteFeedback.id, id));
}
