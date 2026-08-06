import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import type { AgentToolDef } from "~/lib/agents/contracts";
import { toolFromYaml, toolToYaml } from "~/lib/agents/yaml";

type ParsedTool = ReturnType<typeof toolFromYaml>;

export function ToolEditor({
  tool,
  initialText,
  onChange,
  onCancel,
}: {
  tool: AgentToolDef;
  initialText?: string;
  onChange: (tool: AgentToolDef) => void;
  onCancel?: () => void;
}) {
  const seed = initialText ?? toolToYaml(tool);
  const [text, setText] = useState(seed);
  const [parsed, setParsed] = useState<ParsedTool>(() => toolFromYaml(seed));
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setParsed(toolFromYaml(text));
      setPending(false);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [text]);

  const error = !pending && "error" in parsed ? parsed.error : undefined;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/15 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Tool YAML</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Edit the contract and browser-sandboxed JavaScript together.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {pending ? "Checking..." : error ? "Needs attention" : "Valid"}
        </span>
      </div>
      <Textarea
        aria-label="Tool YAML"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "tool-yaml-error" : undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setPending(true);
        }}
        spellCheck={false}
        className="min-h-80 resize-y whitespace-pre overflow-x-auto font-mono text-xs leading-relaxed sm:text-sm"
      />
      {error && (
        <p id="tool-yaml-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !("value" in parsed)}
          onClick={() => {
            if ("value" in parsed && parsed.value) onChange(parsed.value);
          }}
        >
          Apply tool
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <p className="basis-full text-xs text-muted-foreground sm:ml-auto sm:basis-auto">
          Apply here, then save the agent version.
        </p>
      </div>
    </div>
  );
}
