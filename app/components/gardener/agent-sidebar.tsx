import { MessageCircle, Send, Sprout, SquarePen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatMessageBubble } from "./chat-message";
import { ContextChips } from "./context-chips";
import { useGardener } from "./gardener-provider";
import { ModelPicker } from "./model-picker";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";

function Composer() {
  const { ask, busy } = useGardener();
  const [draft, setDraft] = useState("");

  const send = () => {
    const question = draft.trim();
    if (!question || busy) return;
    ask(question);
    setDraft("");
  };

  return (
    <form
      className="flex items-end gap-2 border-t p-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Ask The Gardener anything"
        rows={1}
        className="min-h-9 resize-none text-sm"
      />
      <Button
        type="submit"
        size="icon"
        aria-label="Send"
        className="shrink-0"
        disabled={busy}
      >
        <Send className="size-4" />
      </Button>
    </form>
  );
}

function PanelBody() {
  const { messages, busy } = useGardener();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {messages.map((m) => (
            <ChatMessageBubble key={m.id} message={m} />
          ))}
          {busy && messages[messages.length - 1]?.text === "" && (
            <p className="pl-9 text-xs text-muted-foreground">
              The Gardener is thinking...
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <ContextChips />
      <Composer />
    </>
  );
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  const { clearConversation, busy } = useGardener();
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b px-3">
      <div className="flex items-center gap-2 font-serif">
        <Sprout className="size-4 text-primary" />
        The Gardener
      </div>
      <div className="flex items-center gap-1">
        <ModelPicker />
        <Button
          variant="ghost"
          size="icon"
          aria-label="New conversation"
          title="New conversation"
          disabled={busy}
          onClick={clearConversation}
        >
          <SquarePen className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close The Gardener"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function AgentSidebar() {
  const { open, setOpen } = useGardener();
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        {!open && (
          <Button
            size="icon"
            aria-label="Open The Gardener"
            onClick={() => setOpen(true)}
            className="fixed right-4 bottom-4 z-40 size-12 rounded-full shadow-lg"
          >
            <MessageCircle className="size-5" />
          </Button>
        )}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="flex h-[85dvh] flex-col gap-0 p-0"
          >
            <SheetTitle className="sr-only">The Gardener</SheetTitle>
            <PanelHeader onClose={() => setOpen(false)} />
            <PanelBody />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="icon"
        aria-label="Open The Gardener"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 hidden size-11 rounded-full shadow-md md:flex"
      >
        <MessageCircle className="size-5" />
      </Button>
    );
  }

  return <DesktopRail onClose={() => setOpen(false)} />;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 400;
const WIDTH_KEY = "vg-gardener-width";

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

function DesktopRail({ onClose }: { onClose: () => void }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (saved) setWidth(clampWidth(saved));
  }, []);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setWidth(clampWidth(window.innerWidth - e.clientX));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    setWidth((w) => {
      localStorage.setItem(WIDTH_KEY, String(w));
      return w;
    });
  };

  return (
    <aside
      aria-label="The Gardener"
      style={{ width }}
      className="relative sticky top-0 hidden h-dvh shrink-0 flex-col border-l bg-sidebar md:flex"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize The Gardener panel"
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none transition-colors hover:bg-primary/25",
          dragging && "bg-primary/40",
        )}
      />
      <PanelHeader onClose={onClose} />
      <PanelBody />
    </aside>
  );
}
