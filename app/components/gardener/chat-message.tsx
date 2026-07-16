import { Blocks, BookOpen, Globe, Sprout } from "lucide-react";
import Markdown from "react-markdown";
import { ContextQuote } from "./context-quote";
import { DataToolResult } from "./data-tool-result";
import type { ChatMessage } from "./gardener-provider";
import { MermaidToolResult } from "./mermaid-tool-result";
import { ContentCard, ContentLink } from "~/components/content-link";
import { getArticle } from "~/lib/content";
import { getModule } from "~/lib/modules";
import {
  splitToolNotes,
  stripToolEcho,
  type ToolNoteSegment,
} from "~/lib/tool-notes";
import { cn } from "~/lib/utils";

function ActivityBubble({ label }: { label: string }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
      <span className="shimmer">{label}</span>
    </div>
  );
}

function toolActivityLabel(
  segment: Extract<ToolNoteSegment, { type: "tool" }>,
) {
  if (segment.kind === "article") {
    return `Reading ${getArticle(segment.value)?.meta.title ?? "an article"}`;
  }
  if (segment.kind === "module") {
    return `Reading ${getModule(segment.value)?.meta.title ?? "a building block"}`;
  }
  if (segment.kind === "web") return `Checking ${segment.value}`;
  return segment.value.charAt(0).toUpperCase() + segment.value.slice(1);
}

/** A tool activity aside: its own small bubble between the text bubbles. */
function ToolNoteBubble({
  segment,
  active = false,
}: {
  segment: Extract<ToolNoteSegment, { type: "tool" }>;
  active?: boolean;
}) {
  if (active) return <ActivityBubble label={toolActivityLabel(segment)} />;

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
        <Markdown components={{ a: ContentLink }}>{text}</Markdown>
      </div>
    </div>
  );
}

export function ChatMessageBubble({
  message,
  isStreaming = false,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
}) {
  const isGardener = message.role === "gardener";
  const segments = isGardener ? splitToolNotes(message.text) : [];
  const activeToolIndex =
    isStreaming && !message.error && segments.at(-1)?.type === "tool"
      ? segments.length - 1
      : -1;
  // Between the browser finishing a query and the narration streaming in,
  // the answer ends on a result: show that the Gardener is still at work.
  const readingResults =
    isStreaming && !message.error && segments.at(-1)?.type === "queryresult";
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
            {segments.length === 0 &&
              (isStreaming && !message.error && !message.text ? (
                <ActivityBubble label="The Gardener is thinking..." />
              ) : (
                <GardenerTextBubble text="" error={message.error} />
              ))}
            {segments.map((segment, i) => {
              if (segment.type === "text") {
                // Drop any tool-echo the model parroted; skip if nothing left.
                const clean = message.error
                  ? segment.text
                  : stripToolEcho(segment.text);
                if (!clean) return null;
                return (
                  <GardenerTextBubble
                    key={i}
                    text={clean}
                    error={message.error}
                  />
                );
              }
              if (segment.type === "diagram") {
                return (
                  <MermaidToolResult
                    key={i}
                    title={segment.title}
                    diagram={segment.diagram}
                  />
                );
              }
              if (segment.type === "query") {
                // Its result, when present, is the very next segment;
                // render the pair as one block.
                const next = segments[i + 1];
                return (
                  <DataToolResult
                    key={i}
                    sql={segment.sql}
                    chart={segment.chart}
                    result={
                      next?.type === "queryresult" ? next.result : undefined
                    }
                    running={isStreaming && !message.error}
                  />
                );
              }
              if (segment.type === "queryresult") return null; // consumed above
              return (
                <ToolNoteBubble
                  key={i}
                  segment={segment}
                  active={i === activeToolIndex}
                />
              );
            })}
            {readingResults && (
              <ActivityBubble label="Reading the results..." />
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
