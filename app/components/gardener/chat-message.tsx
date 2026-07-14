import { Sprout } from "lucide-react";
import type { ChatMessage } from "./gardener-provider";
import { cn } from "~/lib/utils";

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  const isGardener = message.role === "gardener";
  return (
    <div className={cn("flex gap-2.5", !isGardener && "justify-end")}>
      {isGardener && (
        <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent">
          <Sprout className="size-3.5 text-accent-foreground" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
          isGardener
            ? "bg-muted text-foreground"
            : "bg-primary text-primary-foreground",
        )}
      >
        {message.text}
      </div>
    </div>
  );
}
