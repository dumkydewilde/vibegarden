import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "./db.server";
import { chatMessages, chatThreads } from "~/db/schema";

const TITLE_MAX = 64;

export async function latestThread(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.userId, userId))
    .orderBy(desc(chatThreads.updatedAt), desc(chatThreads.createdAt))
    .limit(1);
  return rows[0];
}

async function createThread(db: Db, userId: string) {
  const now = Date.now();
  const thread = {
    id: crypto.randomUUID(),
    userId,
    title: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(chatThreads).values(thread);
  return thread;
}

export async function ensureThread(db: Db, userId: string) {
  return (await latestThread(db, userId)) ?? createThread(db, userId);
}

export async function newThread(env: Env, userId: string) {
  return createThread(getDb(env), userId);
}

/** The active (latest) thread and its messages, for the sidebar. */
export async function activeThread(env: Env, userId: string, limit = 50) {
  const db = getDb(env);
  const thread = await latestThread(db, userId);
  if (!thread) return { threadId: null, messages: [] };
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, thread.id))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  return { threadId: thread.id, messages: rows.reverse() };
}

/** Non-empty threads for the conversations list, newest first. */
export async function listThreads(env: Env, userId: string) {
  const db = getDb(env);
  return db
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      updatedAt: chatThreads.updatedAt,
      messageCount: sql<number>`count(${chatMessages.id})`,
    })
    .from(chatThreads)
    .innerJoin(chatMessages, eq(chatMessages.threadId, chatThreads.id))
    .where(eq(chatThreads.userId, userId))
    .groupBy(chatThreads.id)
    .orderBy(desc(chatThreads.updatedAt));
}

/** A single thread with messages, only if it belongs to the user. */
export async function getThread(env: Env, userId: string, threadId: string) {
  const db = getDb(env);
  const rows = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)))
    .limit(1);
  const thread = rows[0];
  if (!thread) return null;
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.createdAt));
  return { thread, messages };
}

/** Makes an old thread the active one again. */
export async function touchThread(env: Env, userId: string, threadId: string) {
  await getDb(env)
    .update(chatThreads)
    .set({ updatedAt: Date.now() })
    .where(
      and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)),
    );
}

export async function saveMessage(
  db: Db,
  thread: { id: string; title: string | null },
  role: "user" | "assistant",
  content: string,
  context?: string,
) {
  const now = Date.now();
  await db.insert(chatMessages).values({
    id: crypto.randomUUID(),
    threadId: thread.id,
    role,
    content,
    context: context ?? null,
    createdAt: now,
  });
  // First user message becomes the thread title.
  const title =
    !thread.title && role === "user"
      ? content.slice(0, TITLE_MAX).trim()
      : undefined;
  await db
    .update(chatThreads)
    .set({ updatedAt: now, ...(title ? { title } : {}) })
    .where(eq(chatThreads.id, thread.id));
  if (title) thread.title = title;
}
