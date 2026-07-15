import { MessageSquare } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { CommentThread } from "./comment-thread";
import type { CommentTargetType } from "~/lib/comment-target";
import type { CommentView } from "~/lib/comments.server";

/** A "Discuss (n)" button that opens a dialog hosting the comment thread. */
export function CommentDialog({
  targetType,
  targetId,
  title,
  comments,
  canModerate,
}: {
  targetType: CommentTargetType;
  targetId: string;
  title: string;
  comments: CommentView[];
  canModerate: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          aria-label={`Discuss ${title}`}
        >
          <MessageSquare className="size-3.5" />
          Discuss
          {comments.length > 0 && <span>({comments.length})</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif font-normal">{title}</DialogTitle>
          <DialogDescription>
            Share what you would build, questions, or things you noticed.
          </DialogDescription>
        </DialogHeader>
        <CommentThread
          targetType={targetType}
          targetId={targetId}
          comments={comments}
          canModerate={canModerate}
        />
      </DialogContent>
    </Dialog>
  );
}
