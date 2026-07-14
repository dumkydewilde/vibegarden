import { Blocks, BookOpen, Globe, Sprout } from "lucide-react";
import Markdown from "react-markdown";
import { Link } from "react-router";
import { ContextQuote } from "./context-quote";
import type { ChatMessage } from "./gardener-provider";
import { getArticle } from "~/lib/content";
import { getModule } from "~/lib/modules";
import { splitToolNotes, type ToolNoteSegment } from "~/lib/tool-notes";
import { cn } from "~/lib/utils";

/** The small clickable card for an article or building block. */
function ContentCard({
  to,
  icon: Icon,
  title,
}: {
  to: string;
  icon: typeof BookOpen;
  title: string;
}) {
  return (
    <Link
      to={to}
      className="my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 align-middle text-xs font-medium not-italic text-foreground no-underline shadow-xs transition-colors hover:border-primary/50"
    >
      <Icon className="size-3.5 shrink-0 text-primary" />
      <span className="truncate">{title}</span>
    </Link>
  );
}

/**
 * Links in replies: learning articles and building blocks become little
 * cards so they stand apart from web URLs; other internal links go through
 * the router.
 */
function MdLink({
  href,
  children,
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const articleSlug = href?.match(/^\/learning\/([\w-]+)$/)?.[1];
  const article = articleSlug ? getArticle(articleSlug) : undefined;
  if (article) {
    return <ContentCard to={href!} icon={BookOpen} title={article.meta.title} />;
  }
  const moduleSlug = href?.match(/^\/garden\/modules\/([\w-]+)$/)?.[1];
  const module = moduleSlug ? getModule(moduleSlug) : undefined;
  if (module) {
    return <ContentCard to={href!} icon={Blocks} title={module.meta.title} />;
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

/** A tool activity aside: its own small bubble between the text bubbles. */
function ToolNoteBubble({
  segment,
}: {
  segment: Extract<ToolNoteSegment, { type: "tool" }>;
}) {
  const wrapper =
    "flex max-w-full items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs italic text-muted-foreground";

  if (segment.kind === "article") {
    const article = getArticle(segment.value);
    if (article) {
      return (
        <div className={wrapper}>
          <span className="shrink-0">reading</span>
          <ContentCard
            to={`/learning/${segment.value}`}
            icon={BookOpen}
            title={article.meta.title}
          />
        </div>
      );
    }
  }
  if (segment.kind === "module") {
    const module = getModule(segment.value);
    if (module) {
      return (
        <div className={wrapper}>
          <span className="shrink-0">reading</span>
          <ContentCard
            to={`/garden/modules/${segment.value}`}
            icon={Blocks}
            title={module.meta.title}
          />
        </div>
      );
    }
  }
  if (segment.kind === "web") {
    return (
      <div className={wrapper}>
        <Globe className="size-3.5 shrink-0" />
        <span className="truncate">reading {segment.value}</span>
      </div>
    );
  }
  return <div className={wrapper}>{segment.value}</div>;
}

function GardenerTextBubble({
  text,
  error,
}: {
  text: string;
  error?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed text-foreground",
        error && "bg-destructive/10 text-destructive",
      )}
    >
      <div className="space-y-2 [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-background/60 [&_pre]:p-2 [&_ul]:list-disc">
        <Markdown components={{ a: MdLink }}>{text}</Markdown>
      </div>
    </div>
  );
}

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  const isGardener = message.role === "gardener";
  const segments = isGardener ? splitToolNotes(message.text) : [];
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
        {isGardener ? (
          <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-1.5">
            {segments.length === 0 && (
              <GardenerTextBubble text="" error={message.error} />
            )}
            {segments.map((segment, i) =>
              segment.type === "text" ? (
                <GardenerTextBubble
                  key={i}
                  text={segment.text}
                  error={message.error}
                />
              ) : (
                <ToolNoteBubble key={i} segment={segment} />
              ),
            )}
          </div>
        ) : (
          <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground">
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
