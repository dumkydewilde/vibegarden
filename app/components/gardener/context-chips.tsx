import { BookOpen, FileText, Quote, X } from "lucide-react";
import { useGardener, type ContextItem } from "./gardener-provider";
import { Badge } from "~/components/ui/badge";

const kindIcon = {
  page: FileText,
  article: BookOpen,
  paragraph: Quote,
} as const;

export function ContextChips() {
  const { contextItems, removeContext } = useGardener();
  if (contextItems.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 border-t px-3 py-2">
      {contextItems.map((item: ContextItem) => {
        const Icon = kindIcon[item.kind];
        return (
          <Badge
            key={item.id}
            variant="secondary"
            className="max-w-full gap-1 pr-1 font-normal"
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{item.label}</span>
            <button
              type="button"
              aria-label={`Remove ${item.label} from context`}
              onClick={() => removeContext(item.id)}
              className="ml-0.5 rounded-sm p-0.5 hover:bg-foreground/10"
            >
              <X className="size-3" />
            </button>
          </Badge>
        );
      })}
    </div>
  );
}
