import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb, type Db } from "./db.server";
import { chatMessages, chatThreads, users } from "~/db/schema";

const TITLE_MAX = 64;

export type StoredContext = {
  kind: "page" | "article" | "paragraph" | "project" | "dataset";
  label: string;
  content: string;
};

/** Stored context JSON on a message row, parsed defensively. */
export function parseContext(raw: string | null): StoredContext[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function latestThread(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.userId, userId))
    .orderBy(desc(chatThreads.updatedAt), desc(chatThreads.createdAt))
    .limit(1);
  return rows[0];
}

async function createThread(db: Db, userId: string, projectId?: string) {
  const now = Date.now();
  const thread = {
    id: crypto.randomUUID(),
    userId,
    title: null,
    projectId: projectId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(chatThreads).values(thread);
  return thread;
}

export async function ensureThread(db: Db, userId: string) {
  return (await latestThread(db, userId)) ?? createThread(db, userId);
}

export async function newThread(env: Env, userId: string, projectId?: string) {
  return createThread(getDb(env), userId, projectId);
}

/** Marks a thread as belonging to a project (first project wins). */
export async function tagThreadWithProject(
  env: Env,
  userId: string,
  threadId: string,
  projectId: string,
) {
  await getDb(env)
    .update(chatThreads)
    .set({ projectId })
    .where(
      and(
        eq(chatThreads.id, threadId),
        eq(chatThreads.userId, userId),
        isNull(chatThreads.projectId),
      ),
    );
}

/** Non-empty conversations that belong to a project, newest first. */
export async function listProjectThreads(
  env: Env,
  userId: string,
  projectId: string,
  primaryThreadId?: string | null,
) {
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
    .where(
      and(
        eq(chatThreads.userId, userId),
        primaryThreadId
          ? or(
              eq(chatThreads.projectId, projectId),
              eq(chatThreads.id, primaryThreadId),
            )
          : eq(chatThreads.projectId, projectId),
      ),
    )
    .groupBy(chatThreads.id)
    .orderBy(desc(chatThreads.updatedAt));
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

/** Non-empty conversations for the protected admin review area. */
export async function listAdminThreads(env: Env) {
  const db = getDb(env);
  return db
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      updatedAt: chatThreads.updatedAt,
      messageCount: sql<number>`count(${chatMessages.id})`,
      participant: {
        name: users.name,
        email: users.email,
      },
    })
    .from(chatThreads)
    .innerJoin(users, eq(users.id, chatThreads.userId))
    .innerJoin(chatMessages, eq(chatMessages.threadId, chatThreads.id))
    .groupBy(chatThreads.id, users.id)
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

/** A thread for an already-authorized admin to review. */
export async function getAdminThread(env: Env, threadId: string) {
  const db = getDb(env);
  const rows = await db
    .select({ thread: chatThreads, participant: users })
    .from(chatThreads)
    .innerJoin(users, eq(users.id, chatThreads.userId))
    .where(eq(chatThreads.id, threadId))
    .limit(1);
  const result = rows[0];
  if (!result) return null;

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.createdAt));
  return { ...result, messages };
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

/**
 * A continuation turn (browser ran a query, model narrates the result)
 * belongs to the same visual answer, so it is appended onto the previous
 * assistant row instead of creating a new one. Falls back to a fresh row
 * when the thread has no assistant message yet.
 */
export async function appendToLastAssistantMessage(
  db: Db,
  thread: { id: string; title: string | null },
  suffix: string,
) {
  const rows = await db
    .select({ id: chatMessages.id, content: chatMessages.content })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.threadId, thread.id),
        eq(chatMessages.role, "assistant"),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  const last = rows[0];
  if (!last) {
    await saveMessage(db, thread, "assistant", suffix.trimStart());
    return;
  }
  await db
    .update(chatMessages)
    .set({ content: last.content + suffix })
    .where(eq(chatMessages.id, last.id));
  await db
    .update(chatThreads)
    .set({ updatedAt: Date.now() })
    .where(eq(chatThreads.id, thread.id));
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
