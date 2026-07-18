import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { getDb, type Db } from "./db.server";
import type { ClubUserScope } from "./projects.server";
import { chatMessages, chatThreads, projects, users } from "~/db/schema";

const TITLE_MAX = 64;

export type StoredContext = {
  kind: "page" | "article" | "paragraph" | "project" | "dataset";
  label: string;
  content: string;
};

export type MessagePosition = { createdAt: number; id: string };
export type ThreadPosition = { updatedAt: number; id: string };

function ownedLike(
  column: typeof chatThreads.title | typeof chatMessages.content,
  term: string,
) {
  return sql`${like(sql`lower(${column})`, term)} escape '\\'`;
}

function escapedLikeTerm(query: string) {
  return `%${query.trim().toLowerCase().replace(/[\\%_]/g, "\\\\$&")}%`;
}

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

async function findThread(db: Db, scope: ClubUserScope, threadId: string) {
  const rows = await db
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.id, threadId),
        eq(chatThreads.clubId, scope.clubId),
        eq(chatThreads.userId, scope.userId),
      ),
    )
    .limit(1);
  return rows[0];
}

async function findProject(db: Db, scope: ClubUserScope, projectId: string) {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.clubId, scope.clubId),
        eq(projects.userId, scope.userId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function latestThread(db: Db, scope: ClubUserScope) {
  const rows = await db
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.clubId, scope.clubId),
        eq(chatThreads.userId, scope.userId),
      ),
    )
    .orderBy(desc(chatThreads.updatedAt), desc(chatThreads.createdAt))
    .limit(1);
  return rows[0];
}

async function createThread(db: Db, scope: ClubUserScope, projectId?: string) {
  const now = Date.now();
  const thread = {
    id: crypto.randomUUID(),
    userId: scope.userId,
    clubId: scope.clubId,
    title: null,
    projectId: projectId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(chatThreads).values(thread);
  return thread;
}

export async function ensureThread(db: Db, scope: ClubUserScope) {
  return (await latestThread(db, scope)) ?? createThread(db, scope);
}

export async function newThread(env: Env, scope: ClubUserScope, projectId?: string) {
  const db = getDb(env);
  const project = projectId ? await findProject(db, scope, projectId) : null;
  return createThread(db, scope, project?.id);
}

/** Marks a thread as belonging to a project (first project wins). */
export async function tagThreadWithProject(
  env: Env,
  scope: ClubUserScope,
  threadId: string,
  projectId: string,
) {
  const db = getDb(env);
  if (!(await findProject(db, scope, projectId))) return false;
  if (!(await findThread(db, scope, threadId))) return false;
  await db
    .update(chatThreads)
    .set({ projectId })
    .where(
      and(
        eq(chatThreads.id, threadId),
        eq(chatThreads.clubId, scope.clubId),
        eq(chatThreads.userId, scope.userId),
        isNull(chatThreads.projectId),
      ),
    );
  return true;
}

/** Non-empty conversations that belong to a project, newest first. */
export async function listProjectThreads(
  env: Env,
  scope: ClubUserScope,
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
        eq(chatThreads.clubId, scope.clubId),
        eq(chatThreads.userId, scope.userId),
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

export async function listProjectThreadsPage(
  env: Env,
  scope: ClubUserScope,
  projectId: string,
  primaryThreadId: string | null,
  input: { position?: ThreadPosition; limit: number },
) {
  const filters = [
    eq(chatThreads.clubId, scope.clubId),
    eq(chatThreads.userId, scope.userId),
    primaryThreadId
      ? or(
          eq(chatThreads.projectId, projectId),
          eq(chatThreads.id, primaryThreadId),
        )
      : eq(chatThreads.projectId, projectId),
  ];
  if (input.position) {
    filters.push(
      or(
        lt(chatThreads.updatedAt, input.position.updatedAt),
        and(
          eq(chatThreads.updatedAt, input.position.updatedAt),
          lt(chatThreads.id, input.position.id),
        ),
      )!,
    );
  }
  const rows = await getDb(env)
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      updatedAt: chatThreads.updatedAt,
      messageCount: sql<number>`count(${chatMessages.id})`,
    })
    .from(chatThreads)
    .innerJoin(chatMessages, eq(chatMessages.threadId, chatThreads.id))
    .where(and(...filters))
    .groupBy(chatThreads.id)
    .orderBy(desc(chatThreads.updatedAt), desc(chatThreads.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    nextPosition:
      hasMore && last
        ? { updatedAt: last.updatedAt, id: last.id }
        : undefined,
  };
}

export async function searchOwnedThreads(
  env: Env,
  scope: ClubUserScope,
  query: string,
  limit: number,
) {
  const term = escapedLikeTerm(query);
  return getDb(env)
    .selectDistinct({
      id: chatThreads.id,
      title: chatThreads.title,
      updatedAt: chatThreads.updatedAt,
    })
    .from(chatThreads)
    .leftJoin(chatMessages, eq(chatMessages.threadId, chatThreads.id))
    .where(
      and(
        eq(chatThreads.clubId, scope.clubId),
        eq(chatThreads.userId, scope.userId),
        or(
          ownedLike(chatThreads.title, term),
          ownedLike(chatMessages.content, term),
        ),
      ),
    )
    .orderBy(desc(chatThreads.updatedAt), desc(chatThreads.id))
    .limit(Math.min(Math.max(Math.trunc(limit), 0), 20));
}

/** The active (latest) thread and its messages, for the sidebar. */
export async function activeThread(env: Env, scope: ClubUserScope, limit = 50) {
  const db = getDb(env);
  const thread = await latestThread(db, scope);
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
export async function listThreads(env: Env, scope: ClubUserScope) {
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
        eq(chatThreads.clubId, scope.clubId),
        eq(chatThreads.userId, scope.userId),
      ),
    )
    .groupBy(chatThreads.id)
    .orderBy(desc(chatThreads.updatedAt));
}

/** Non-empty conversations for the protected admin review area. */
export async function listAdminThreads(env: Env, clubId: string) {
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
    .where(eq(chatThreads.clubId, clubId))
    .groupBy(chatThreads.id, users.id)
    .orderBy(desc(chatThreads.updatedAt));
}

/** A single thread with messages, only if it belongs to the user. */
export async function getThread(env: Env, scope: ClubUserScope, threadId: string) {
  const db = getDb(env);
  const thread = await findThread(db, scope, threadId);
  if (!thread) return null;
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.createdAt));
  return { thread, messages };
}

export async function getThreadPage(
  env: Env,
  scope: ClubUserScope,
  threadId: string,
  input: { position?: MessagePosition; limit: number },
) {
  const db = getDb(env);
  const owned = await db
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.id, threadId),
        eq(chatThreads.clubId, scope.clubId),
        eq(chatThreads.userId, scope.userId),
      ),
    )
    .limit(1);
  if (!owned[0]) return null;

  const filters = [
    eq(chatThreads.id, threadId),
    eq(chatThreads.clubId, scope.clubId),
    eq(chatThreads.userId, scope.userId),
  ];
  if (input.position) {
    filters.push(
      or(
        gt(chatMessages.createdAt, input.position.createdAt),
        and(
          eq(chatMessages.createdAt, input.position.createdAt),
          gt(chatMessages.id, input.position.id),
        ),
      )!,
    );
  }
  const rows = await db
    .select({ message: chatMessages })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
    .where(and(...filters))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const messages = rows.slice(0, input.limit).map((row) => row.message);
  const last = messages.at(-1);
  return {
    thread: owned[0],
    messages,
    nextPosition:
      hasMore && last
        ? { createdAt: last.createdAt, id: last.id }
        : undefined,
  };
}

/** A thread for an already-authorized admin to review. */
export async function getAdminThread(env: Env, clubId: string, threadId: string) {
  const db = getDb(env);
  const rows = await db
    .select({ thread: chatThreads, participant: users })
    .from(chatThreads)
    .innerJoin(users, eq(users.id, chatThreads.userId))
    .where(and(eq(chatThreads.id, threadId), eq(chatThreads.clubId, clubId)))
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
export async function touchThread(
  env: Env,
  scope: ClubUserScope,
  threadId: string,
) {
  await getDb(env)
    .update(chatThreads)
    .set({ updatedAt: Date.now() })
    .where(
      and(
        eq(chatThreads.id, threadId),
        eq(chatThreads.clubId, scope.clubId),
        eq(chatThreads.userId, scope.userId),
      ),
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
  scope: ClubUserScope,
  thread: { id: string; title: string | null },
  suffix: string,
) {
  if (!(await findThread(db, scope, thread.id))) return false;
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
    await saveMessage(db, scope, thread, "assistant", suffix.trimStart());
    return true;
  }
  await db
    .update(chatMessages)
    .set({ content: last.content + suffix })
    .where(eq(chatMessages.id, last.id));
  await db
    .update(chatThreads)
    .set({ updatedAt: Date.now() })
    .where(eq(chatThreads.id, thread.id));
  return true;
}

export async function saveMessage(
  db: Db,
  scope: ClubUserScope,
  thread: { id: string; title: string | null },
  role: "user" | "assistant",
  content: string,
  context?: string,
) {
  if (!(await findThread(db, scope, thread.id))) return false;
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
  return true;
}
