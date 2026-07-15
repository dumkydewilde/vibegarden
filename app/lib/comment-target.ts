/**
 * Client-safe helpers shared by the comment server layer and the routes that
 * render/submit comments. No server imports here so it can be bundled for the
 * browser (inspiration cards derive their target id from the card title).
 */

export type CommentTargetType = "article" | "inspiration" | "artifact";

export const COMMENT_TARGET_TYPES: readonly CommentTargetType[] = [
  "article",
  "inspiration",
  "artifact",
];

export const COMMENT_MAX = 4000;

/** Trim and cap a comment body. Returns null when there is nothing to post. */
export function normalizeCommentBody(raw: string): string | null {
  const body = raw.trim().slice(0, COMMENT_MAX);
  return body.length > 0 ? body : null;
}

export function isCommentTargetType(value: unknown): value is CommentTargetType {
  return (
    typeof value === "string" &&
    COMMENT_TARGET_TYPES.includes(value as CommentTargetType)
  );
}

/**
 * Stable id for a code-defined target (inspiration cards). Same philosophy as
 * article slugs: derived from the human title, so it survives across reloads
 * as long as the title is unchanged.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
