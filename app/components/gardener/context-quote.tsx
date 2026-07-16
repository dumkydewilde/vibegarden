import {
  Blocks,
  BookOpen,
  Database,
  FileText,
  Quote,
  Sprout,
  X,
} from "lucide-react";
import type { ContextSnapshot } from "./gardener-provider";
import { cn } from "~/lib/utils";

const kindIcon = {
  page: FileText,
  article: BookOpen,
  module: Blocks,
  paragraph: Quote,
  project: Sprout,
  dataset: Database,
} as const;

const kindLabel = {
  page: "Page",
  article: "Article",
  module: "Building block",
  paragraph: "From the article",
  project: "Freshly planted",
  dataset: "Dataset",
} as const;

/**
 * A piece of context shown as a quote card: in the pending area above the
 * composer, and attached to sent user messages in the conversation.
 */
export function ContextQuote({
  item,
  onRemove,
  className,
}: {
  item: ContextSnapshot;
  onRemove?: () => void;
  className?: string;
}) {
  const Icon = kindIcon[item.kind];
  // Article context carries the full raw text; showing the title is enough.
  const preview =
    item.kind === "paragraph" ||
    item.kind === "project" ||
    item.kind === "dataset"
      ? item.content
      : null;

  return (
    <figure
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-l-2 border-l-primary/50 bg-muted/60 px-3 py-2 text-left",
        className,
      )}
    >
      <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3 shrink-0" />
        <span className="truncate">
          {item.kind === "paragraph" ? kindLabel[item.kind] : item.label}
        </span>
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove ${item.label} from context`}
            onClick={onRemove}
            className="ml-auto rounded-sm p-0.5 hover:bg-foreground/10"
          >
            <X className="size-3" />
          </button>
        )}
      </figcaption>
      {preview && (
        <blockquote className="mt-1 line-clamp-3 [overflow-wrap:anywhere] font-serif text-xs italic leading-relaxed text-foreground/80">
          {preview}
        </blockquote>
      )}
    </figure>
  );
}
