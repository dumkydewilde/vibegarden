import { Database, Send, Sprout, SquarePen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatMessageBubble } from "./chat-message";
import { ContextChips } from "./context-chips";
import { useGardener } from "./gardener-provider";
import { ModelPicker } from "./model-picker";
import { ToolsMenu } from "./tools-menu";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { useIsMobile } from "~/hooks/use-mobile";
import { extractDataUrls, stripDataUrls } from "@vibegarden/agent-web";
import { cn } from "~/lib/utils";

/** Brief indicator while a dataset is being fetched and introspected. */
function AttachingDatasetNote() {
  const { attachingDataset } = useGardener();
  if (!attachingDataset) return null;
  return (
    <div className="flex border-t px-3 py-2">
      <span className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
        <Database className="size-3" />
        <span className="shimmer">Reading {attachingDataset}...</span>
      </span>
    </div>
  );
}

function Composer() {
  const { ask, busy, composerRef, datasets, attachDataset, attachingDataset } =
    useGardener();
  const [draft, setDraft] = useState("");

  const send = async () => {
    const raw = draft.trim();
    if (!raw || busy || attachingDataset) return;
    setDraft("");
    // A data-file link pasted into the message is attached on the fly, so
    // there is no need to open the tools menu. Skip links already loaded.
    const loaded = new Set(
      datasets.map((d) => d.sourceUrl).filter(Boolean) as string[],
    );
    const fresh = extractDataUrls(raw).filter((u) => !loaded.has(u));
    for (const url of fresh) {
      await attachDataset({ kind: "url", url });
    }
    // Once attached, strip the link from the message so the model queries
    // the dataset rather than fetching the raw file into its context.
    const question = extractDataUrls(raw).length
      ? stripDataUrls(raw) || "Tell me about the data I just attached."
      : raw;
    ask(question);
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
        ref={composerRef}
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
      <ToolsMenu />
      <Button
        type="submit"
        size="icon"
        aria-label="Send"
        className="shrink-0"
        disabled={busy || attachingDataset !== null}
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
            <ChatMessageBubble
              key={m.id}
              message={m}
              isStreaming={
                busy &&
                m.id === messages[messages.length - 1]?.id &&
                m.role === "gardener"
              }
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <AttachingDatasetNote />
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
        {!open && <LauncherPill onClick={() => setOpen(true)} />}
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
      <LauncherPill onClick={() => setOpen(true)} className="hidden md:flex" />
    );
  }

  return <DesktopRail onClose={() => setOpen(false)} />;
}

function LauncherPill({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      aria-label="Ask the Gardener"
      onClick={onClick}
      className={cn(
        "fixed right-6 bottom-8 z-40 h-12 cursor-pointer gap-2 rounded-full border border-primary/25 bg-accent px-5 font-serif text-sm text-accent-foreground shadow-lg hover:bg-accent/80",
        className,
      )}
    >
      <Sprout className="size-5 text-primary" />
      Ask the Gardener
    </Button>
  );
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 480;
// v2: the default widened for data tables; a new key resets stale widths.
const WIDTH_KEY = "vg-gardener-width-2";

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
