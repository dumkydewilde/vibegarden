import { Sprout } from "lucide-react";
import Markdown from "react-markdown";
import { Link } from "react-router";
import type { ChatMessage } from "./gardener-provider";
import { cn } from "~/lib/utils";

// Internal links go through the router; external ones open a new tab.
function MdLink({
  href,
  children,
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href?.startsWith("/")) {
    return (
      <Link to={href} className="text-primary underline underline-offset-2">
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  );
}

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
          message.error && "bg-destructive/10 text-destructive",
        )}
      >
        {isGardener ? (
          <div className="space-y-2 [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-background/60 [&_pre]:p-2 [&_ul]:list-disc">
            <Markdown components={{ a: MdLink }}>{message.text}</Markdown>
          </div>
        ) : (
          message.text
        )}
      </div>
    </div>
  );
}
