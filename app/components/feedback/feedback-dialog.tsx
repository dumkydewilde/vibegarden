import { useFetcher, useLocation } from "react-router";
import { MessageSquarePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { FEEDBACK_MAX } from "~/lib/feedback";

/**
 * A "Feedback" button that opens a dialog to send a private note to the admin.
 * Captures the current path so the admin knows where it came from. Posts to the
 * /api/feedback resource route, so it works from anywhere in the app.
 */
export function FeedbackDialog({
  className,
  onDone,
}: {
  className?: string;
  /** Called after a successful send (e.g. to close a mobile nav sheet). */
  onDone?: () => void;
}) {
  const fetcher = useFetcher();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const sending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      formRef.current?.reset();
      setOpen(false);
      onDone?.();
    }
  }, [fetcher.state, fetcher.data, onDone]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className ?? "gap-1.5 text-muted-foreground"}
        >
          <MessageSquarePlus className="size-3.5" />
          Feedback
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif font-normal">
            Send feedback
          </DialogTitle>
          <DialogDescription>
            Anything confusing, broken, or missing? This goes straight to the
            host, only they can see it.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form
          ref={formRef}
          method="post"
          action="/api/feedback"
          className="space-y-3"
        >
          <input type="hidden" name="page" value={pathname} />
          <Textarea
            name="body"
            required
            rows={4}
            maxLength={FEEDBACK_MAX}
            placeholder="What's on your mind?"
            aria-label="Your feedback"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
