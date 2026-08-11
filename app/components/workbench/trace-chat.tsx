import { Activity, RotateCcw, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import Markdown from "react-markdown";
import { splitToolNotes } from "@vibegarden/agent-web";

import { CallCard } from "./call-card";
import {
  rawResultKey,
  type ChatEntry,
  type RawResultKey,
} from "./use-agent-chat";
import { ContentLink } from "~/components/content-link";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";

export function TraceChat({
  entries,
  rawResults,
  busy,
  send,
  reset,
}: {
  entries: ChatEntry[];
  rawResults: Map<RawResultKey, string>;
  busy: boolean;
  send: (text: string) => Promise<void>;
  reset: () => void;
}) {
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setMessage("");
    await send(text);
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="font-serif text-xl font-normal">
              Test chat
            </CardTitle>
            <CardDescription>
              Follow each tool call from request to model context.
            </CardDescription>
          </div>
          {entries.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={busy}
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="flex min-h-72 max-h-[36rem] flex-col gap-3 overflow-y-auto rounded-lg border bg-muted/20 p-4"
          aria-live="polite"
        >
          {entries.length === 0 ? (
            <div className="m-auto max-w-xs text-center text-sm text-muted-foreground">
              Send a message to see the agent reason, call tools, and use their
              results.
            </div>
          ) : (
            entries.map((entry, entryIndex) => {
              if (entry.role === "user") {
                return (
                  <div
                    key={`${entry.role}-${entryIndex}`}
                    className="ml-auto max-w-[85%] rounded-xl bg-primary px-3.5 py-2.5 text-sm text-primary-foreground"
                  >
                    {entry.content}
                  </div>
                );
              }

              const segments = splitToolNotes(entry.content);
              let resultIndex = 0;
              return (
                <div
                  key={`${entry.role}-${entryIndex}`}
                  className="flex max-w-[94%] flex-col items-start gap-2"
                >
                  {segments.length === 0 && !entry.content ? (
                    <div className="rounded-xl border bg-background px-3.5 py-2.5 text-sm text-muted-foreground">
                      <span className="shimmer">Thinking...</span>
                    </div>
                  ) : (
                    segments.map((segment, segmentIndex) => {
                      if (segment.type === "text") {
                        return (
                          <div
                            key={segmentIndex}
                            className="w-full rounded-xl border bg-background px-3.5 py-2.5 text-sm leading-relaxed"
                          >
                            <div className="space-y-2 [overflow-wrap:anywhere] [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc">
                              <Markdown components={{ a: ContentLink }}>
                                {segment.text}
                              </Markdown>
                            </div>
                          </div>
                        );
                      }
                      if (segment.type === "tool") {
                        return (
                          <div
                            key={segmentIndex}
                            className="flex max-w-full items-start gap-2 rounded-lg border border-primary/15 bg-primary/[0.04] px-3 py-2 text-xs text-muted-foreground"
                            aria-label="Agent activity"
                          >
                            <Activity className="mt-0.5 size-3.5 shrink-0 text-primary" />
                            <span className="break-words font-mono">
                              {segment.value}
                            </span>
                          </div>
                        );
                      }
                      if (
                        segment.type === "call" ||
                        segment.type === "callresult"
                      ) {
                        const raw =
                          segment.type === "callresult"
                            ? rawResults.get(
                                rawResultKey(entryIndex, resultIndex++),
                              )
                            : undefined;
                        return (
                          <CallCard
                            key={segmentIndex}
                            segment={segment}
                            raw={raw}
                          />
                        );
                      }
                      return null;
                    })
                  )}
                </div>
              );
            })
          )}
        </div>
        <form
          onSubmit={submit}
          className="flex gap-2 md:pr-24 2xl:pr-0"
        >
          <Input
            aria-label="Message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask your agent something..."
            disabled={busy}
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || !message.trim()}
            aria-label="Send message"
          >
            <Send className="size-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
