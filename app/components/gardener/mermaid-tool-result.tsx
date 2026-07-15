import { Expand } from "lucide-react";
import { MermaidDiagram } from "~/components/mermaid-block";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";

function DiagramFallback({ diagram }: { diagram: string }) {
  return (
    <div className="space-y-2 text-left">
      <p className="text-xs text-muted-foreground">
        This diagram could not be rendered. Here is its Mermaid source.
      </p>
      <pre className="max-w-full overflow-auto rounded-md bg-muted p-3 text-xs">
        <code>{diagram}</code>
      </pre>
    </div>
  );
}

function DiagramLoading() {
  return (
    <p className="py-8 text-center text-xs text-muted-foreground">
      Rendering flow...
    </p>
  );
}

export function MermaidToolResult({
  title,
  diagram,
}: {
  title: string;
  diagram: string;
}) {
  const fallback = <DiagramFallback diagram={diagram} />;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Expand diagram: ${title}`}
          className="group w-full overflow-hidden rounded-lg border bg-background text-left shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm font-medium">
            <span>{title}</span>
            <Expand className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
          </div>
          <div className="max-h-72 overflow-auto p-3">
            <MermaidDiagram
              code={diagram}
              ariaLabel={title}
              loadingFallback={<DiagramLoading />}
              fallback={fallback}
            />
          </div>
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-[90vw] flex-col sm:max-w-[80rem]">
        <DialogHeader>
          <DialogTitle className="pr-8 font-serif font-normal">
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background p-4">
          <MermaidDiagram
            code={diagram}
            ariaLabel={title}
            loadingFallback={<DiagramLoading />}
            fallback={fallback}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
