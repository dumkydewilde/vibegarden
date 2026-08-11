import { Braces, CircleAlert, Wrench } from "lucide-react";
import { useState } from "react";
import type { ToolNoteSegment } from "@vibegarden/agent-web";

type CallCardSegment = Extract<
  ToolNoteSegment,
  { type: "call" | "callresult" }
>;

export function CallCard({
  segment,
  raw,
}: {
  segment: CallCardSegment;
  raw?: string;
}) {
  const [resultView, setResultView] = useState<"raw" | "model">("raw");

  if (segment.type === "call") {
    return (
      <div className="w-full overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">Calling</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
            {segment.tool}
          </code>
        </div>
        <pre className="max-h-48 overflow-auto border-t bg-muted/30 p-3 text-xs leading-relaxed">
          <code>{JSON.stringify(segment.args, null, 2)}</code>
        </pre>
      </div>
    );
  }

  const { result } = segment;
  const rawText =
    raw ?? (result.status === "ok" ? result.resultText : result.error);
  const header =
    result.status === "ok"
      ? `${result.totalChars.toLocaleString()} chars fetched, the model saw ${result.resultText.length.toLocaleString()}`
      : "The tool returned an error";

  return (
    <div className="w-full overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {result.status === "error" ? (
          <CircleAlert className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Braces className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className={
            result.status === "error"
              ? "text-xs font-medium text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {header}
        </span>
      </div>
      <div>
        <div role="tablist" className="mx-3 flex h-10 items-center gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={resultView === "raw"}
            onClick={() => setResultView("raw")}
            className="h-full border-b-2 border-transparent px-2 text-sm text-muted-foreground transition-colors aria-selected:border-foreground aria-selected:text-foreground"
          >
            Raw
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={resultView === "model"}
            onClick={() => setResultView("model")}
            className="h-full border-b-2 border-transparent px-2 text-sm text-muted-foreground transition-colors aria-selected:border-foreground aria-selected:text-foreground"
          >
            Sent to model
          </button>
        </div>
        {resultView === "raw" ? (
          <div role="tabpanel" aria-label="Raw">
            <pre className="max-h-96 overflow-auto border-t bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {rawText}
            </pre>
          </div>
        ) : (
          <div role="tabpanel" aria-label="Sent to model">
            {result.status === "error" ? (
              <p
                role="alert"
                className="border-t bg-destructive/10 p-3 font-mono text-xs leading-relaxed text-destructive whitespace-pre-wrap [overflow-wrap:anywhere]"
              >
                {result.error}
              </p>
            ) : (
              <pre className="max-h-96 overflow-auto border-t bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {result.resultText}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
