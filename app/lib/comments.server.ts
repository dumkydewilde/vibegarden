import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./db.server";
import type { ClubUserScope } from "./projects.server";
import type { ClubContext } from "./clubs.server";
import {
  normalizeCommentBody,
  type CommentTargetType,
} from "./comment-target";
import { comments, users, type Comment, type User } from "~/db/schema";

/** A comment shaped for rendering: author name resolved, ownership flagged. */
export type CommentView = {
  id: string;
  body: string;
  createdAt: number;
  authorName: string;
  /** True when the current viewer wrote it (drives the delete control). */
  own: boolean;
};

function toView(
  row: {
    id: string;
    body: string;
    createdAt: number;
    userId: string;
    name: string | null;
    email: string;
  },
  viewerId?: string,
): CommentView {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    authorName: row.name ?? row.email,
    own: !!viewerId && row.userId === viewerId,
  };
}

const selection = {
  id: comments.id,
  body: comments.body,
  createdAt: comments.createdAt,
  userId: comments.userId,
  name: users.name,
  email: users.email,
} as const;

/** Visible comments for one target, oldest first (reads like a thread). */
export async function listComments(
  env: Env,
  clubId: string,
  targetType: CommentTargetType,
  targetId: string,
  viewerId?: string,
): Promise<CommentView[]> {
  const rows = await getDb(env)
    .select(selection)
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(
      and(
        eq(comments.targetType, targetType),
        eq(comments.targetId, targetId),
        eq(comments.clubId, clubId),
        eq(comments.status, "visible"),
      ),
    )
    .orderBy(asc(comments.createdAt));
  return rows.map((r) => toView(r, viewerId));
}

/**
 * All visible comments of a type, grouped by target id. Used by the
 * inspiration page, which hosts many small threads on one screen.
 */
export async function listCommentsByType(
  env: Env,
  clubId: string,
  targetType: CommentTargetType,
  viewerId?: string,
): Promise<Record<string, CommentView[]>> {
  const rows = await getDb(env)
    .select({ ...selection, targetId: comments.targetId })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(
      and(
        eq(comments.targetType, targetType),
        eq(comments.clubId, clubId),
        eq(comments.status, "visible"),
      ),
    )
    .orderBy(asc(comments.createdAt));
  const grouped: Record<string, CommentView[]> = {};
  for (const row of rows) {
    (grouped[row.targetId] ??= []).push(toView(row, viewerId));
  }
  return grouped;
}

export async function createComment(
  env: Env,
  scope: ClubUserScope,
  input: { targetType: CommentTargetType; targetId: string; body: string },
): Promise<Comment | null> {
  const body = normalizeCommentBody(input.body);
  if (!body) return null;
  const now = Date.now();
  const comment: Comment = {
    id: crypto.randomUUID(),
    targetType: input.targetType,
    targetId: input.targetId,
    userId: scope.userId,
    clubId: scope.clubId,
    parentId: null,
    body,
    status: "visible",
    createdAt: now,
    updatedAt: now,
  };
  await getDb(env).insert(comments).values(comment);
  return comment;
}

/** Delete your own comment; an admin may delete anyone's. */
export async function deleteComment(
  env: Env,
  { user, club }: { user: User; club: ClubContext },
  id: string,
) {
  const db = getDb(env);
  if (club.effectiveRole === "admin" || club.effectiveRole === "owner") {
    await db
      .delete(comments)
      .where(and(eq(comments.id, id), eq(comments.clubId, club.club.id)));
    return;
  }
  await db
    .delete(comments)
    .where(
      and(
        eq(comments.id, id),
        eq(comments.clubId, club.club.id),
        eq(comments.userId, user.id),
      ),
    );
}
