import { desc, eq } from "drizzle-orm";
import { getDb, type Db } from "./db.server";
import { chatMessages, chatThreads } from "~/db/schema";

export async function latestThread(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.userId, userId))
    .orderBy(desc(chatThreads.createdAt))
    .limit(1);
  return rows[0];
}

export async function ensureThread(db: Db, userId: string) {
  const existing = await latestThread(db, userId);
  if (existing) return existing;
  const thread = {
    id: crypto.randomUUID(),
    userId,
    title: null,
    createdAt: Date.now(),
  };
  await db.insert(chatThreads).values(thread);
  return thread;
}

export async function newThread(env: Env, userId: string) {
  const db = getDb(env);
  const thread = {
    id: crypto.randomUUID(),
    userId,
    title: null,
    createdAt: Date.now(),
  };
  await db.insert(chatThreads).values(thread);
  return thread;
}

export async function threadMessages(env: Env, userId: string, limit = 50) {
  const db = getDb(env);
  const thread = await latestThread(db, userId);
  if (!thread) return [];
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, thread.id))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function saveMessage(
  db: Db,
  threadId: string,
  role: "user" | "assistant",
  content: string,
  context?: string,
) {
  await db.insert(chatMessages).values({
    id: crypto.randomUUID(),
    threadId,
    role,
    content,
    context: context ?? null,
    createdAt: Date.now(),
  });
}
