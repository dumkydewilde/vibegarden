import { useFetcher } from "react-router";
import { Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { COMMENT_MAX, type CommentTargetType } from "~/lib/comment-target";
import type { CommentView } from "~/lib/comments.server";

function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}

export function CommentThread({
  targetType,
  targetId,
  comments,
  canModerate,
  now = Date.now(),
}: {
  targetType: CommentTargetType;
  targetId: string;
  comments: CommentView[];
  canModerate: boolean;
  /** Injectable for deterministic tests. */
  now?: number;
}) {
  const post = useFetcher();
  const del = useFetcher();
  const formRef = useRef<HTMLFormElement>(null);
  const posting = post.state !== "idle";

  // Clear the box once a comment lands.
  useEffect(() => {
    if (post.state === "idle" && post.data?.ok) {
      formRef.current?.reset();
    }
  }, [post.state, post.data]);

  return (
    <section aria-label="Discussion" className="not-prose">
      <h2 className="text-lg">
        Discussion
        {comments.length > 0 && (
          <span className="ml-1.5 text-muted-foreground">
            ({comments.length})
          </span>
        )}
      </h2>

      <ul className="mt-4 space-y-4">
        {comments.length === 0 && (
          <li className="text-sm text-muted-foreground">
            No comments yet. Start the conversation.
          </li>
        )}
        {comments.map((c) => (
          <li key={c.id} className="border-l-2 border-border pl-3">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{c.authorName}</span>
              {/* Relative time depends on "now", which differs between the
                  server render and client hydration; let the client win. */}
              <span
                className="text-xs text-muted-foreground"
                suppressHydrationWarning
              >
                {timeAgo(c.createdAt, now)}
              </span>
              {(c.own || canModerate) && (
                <del.Form method="post" className="ml-auto">
                  <input type="hidden" name="intent" value="delete-comment" />
                  <input type="hidden" name="commentId" value={c.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-xs"
                    disabled={del.state !== "idle"}
                    aria-label="Delete comment"
                    className="text-muted-foreground"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </del.Form>
              )}
            </div>
            <p className="mt-1 text-sm whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>

      <post.Form ref={formRef} method="post" className="mt-6 space-y-2">
        <input type="hidden" name="intent" value="comment" />
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        <Textarea
          name="body"
          required
          rows={3}
          maxLength={COMMENT_MAX}
          placeholder="Add to the discussion..."
          aria-label="Your comment"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={posting}>
            {posting ? "Posting..." : "Post comment"}
          </Button>
        </div>
      </post.Form>
    </section>
  );
}
