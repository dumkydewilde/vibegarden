import { useState } from "react";
import { Check, Copy, Plug } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function McpConnectCard({
  serverUrl,
  title,
  description,
  lastStep,
  className,
}: {
  serverUrl: string;
  title: string;
  description: string;
  /** What to do once the connector is on, phrased for the page it sits on. */
  lastStep: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-labelledby="mcp-connect-heading"
      className={cn("rounded-lg border border-primary/30 bg-primary/5 p-4", className)}
    >
      <h2 id="mcp-connect-heading" className="flex items-center gap-2 text-lg">
        <Plug className="size-4 shrink-0 text-primary" aria-hidden /> {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 font-mono text-sm">
          {serverUrl}
        </code>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy server URL"}
        </Button>
      </div>

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          In Claude, open <strong className="font-medium text-foreground">Settings → Connectors → Add custom connector</strong>.
          ChatGPT and Gemini have their own equivalent, see the full setup below.
        </li>
        <li>Paste the URL above, sign in to Vibe Garden, and approve only the access you want.</li>
        <li>{lastStep}</li>
      </ol>

      <p className="mt-3 text-sm">
        <a className="underline underline-offset-4" href="/connect">
          Full setup for Claude, ChatGPT, and Gemini
        </a>
      </p>
    </section>
  );
}
