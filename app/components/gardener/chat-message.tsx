import { BookOpen, Sprout } from "lucide-react";
import Markdown from "react-markdown";
import { Link } from "react-router";
import { ContextQuote } from "./context-quote";
import type { ChatMessage } from "./gardener-provider";
import { getArticle } from "~/lib/content";
import { cn } from "~/lib/utils";

/**
 * Links in replies: learning articles become little cards so they stand
 * apart from web URLs; other internal links go through the router.
 */
function MdLink({
  href,
  children,
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const articleSlug = href?.match(/^\/learning\/([\w-]+)$/)?.[1];
  const article = articleSlug ? getArticle(articleSlug) : undefined;
  if (article) {
    return (
      <Link
        to={href!}
        className="my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 align-middle text-xs font-medium text-foreground no-underline shadow-xs transition-colors hover:border-primary/50"
      >
        <BookOpen className="size-3.5 shrink-0 text-primary" />
        <span className="truncate">{article.meta.title}</span>
      </Link>
    );
  }
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
    <div
      className={cn(
        "flex flex-col gap-1.5",
        !isGardener && "items-end",
      )}
    >
      {message.context?.map((item, i) => (
        <ContextQuote key={i} item={item} className="max-w-[85%]" />
      ))}
      <div className={cn("flex w-full gap-2.5", !isGardener && "justify-end")}>
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
    </div>
  );
}
