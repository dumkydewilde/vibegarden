import { useCallback, useState } from "react";
import {
  CALL_RESULT_MAX_CHARS,
  callNote,
  callErrorEnvelope,
  callResultNote,
  splitToolNotes,
  toModelText,
  type CallResultEnvelope,
  type ToolNoteSegment,
} from "@vibegarden/agent-web";

import {
  AGENT_MESSAGE_MAX_CHARS,
  AGENT_TOOL_TRANSPORT_MAX_CHARS,
  parseAgentChatRequest,
  WORKBENCH_MAX_CONTINUATIONS,
  type AgentChatMessage,
} from "~/lib/agents/chat-request";

export type ChatEntry = {
  role: "user" | "assistant";
  content: string;
};

export type ToolExecutor = (call: {
  tool: string;
  args: Record<string, unknown>;
}) => Promise<
  | { raw: string; envelope: CallResultEnvelope }
  | { raw?: never; envelope: CallResultEnvelope }
>;

type UseAgentChatOptions = {
  clubSlug: string;
  agentId: string;
  versionId: string;
  executors?: Record<string, ToolExecutor>;
  fallbackExecutor?: ToolExecutor;
};

const NOT_REACHABLE = "The language model is not reachable right now.";
const EMPTY_EXECUTORS: Record<string, ToolExecutor> = {};
const DEFAULT_FALLBACK_EXECUTOR: ToolExecutor = async () => ({
  envelope: callErrorEnvelope("No executor for this tool yet."),
});
const UNSAFE_CONTINUATION =
  "The tool finished, but this trace could not be continued safely.";
const UNSAFE_TOOL_CALL =
  "The tool was not run because its result could not be continued safely.";
// U+0800 uses the largest URI encoding per JavaScript character. Proving this
// envelope fits guarantees every capped successful result will fit too.
const MAX_CONTINUATION_ENVELOPE: CallResultEnvelope = {
  status: "ok",
  resultText: "\u0800".repeat(CALL_RESULT_MAX_CHARS),
  totalChars: Number.MAX_SAFE_INTEGER,
  truncated: true,
};

export type RawResultKey = `${number}:${number}`;

export function rawResultKey(
  entryIndex: number,
  resultIndex: number,
): RawResultKey {
  return `${entryIndex}:${resultIndex}`;
}

function traceMarker(segment: ToolNoteSegment): string | null {
  if (segment.type === "call") {
    return callNote({ tool: segment.tool, args: segment.args });
  }
  if (segment.type === "callresult") {
    return callResultNote(segment.result);
  }
  return null;
}

function buildTraceTransport(
  segments: ToolNoteSegment[],
  narrationChars: number,
): string {
  let remaining = narrationChars;
  const retainedText = new Map<number, string>();
  for (let index = segments.length - 1; index >= 0 && remaining > 0; index--) {
    const segment = segments[index];
    if (segment?.type !== "text") continue;
    const text = segment.text.slice(-remaining);
    if (text) retainedText.set(index, text);
    remaining -= text.length;
  }

  return segments
    .flatMap((segment, index) => {
      const marker = traceMarker(segment);
      if (marker) return [marker];
      if (segment.type === "text") {
        const text = retainedText.get(index);
        return text ? [text] : [];
      }
      return [];
    })
    .join("\n\n");
}

/** Keep the complete trace in browser state while bounding model transport. */
function assistantContentForTransport(content: string): string | null {
  const segments = splitToolNotes(content);
  const traceSegments = segments.filter(
    (segment) => segment.type === "call" || segment.type === "callresult",
  );
  if (traceSegments.length === 0) {
    return content.slice(-AGENT_MESSAGE_MAX_CHARS);
  }

  let expected: "call" | "callresult" = "call";
  let markerChars = 0;
  for (const segment of traceSegments) {
    if (segment.type !== expected) return null;
    const marker = traceMarker(segment);
    if (!marker) return null;
    markerChars += marker.length;
    expected = expected === "call" ? "callresult" : "call";
  }

  const narrationChars = segments.reduce(
    (total, segment) =>
      total + (segment.type === "text" ? segment.text.length : 0),
    0,
  );
  const isValid = (candidate: string) =>
    candidate.length <= AGENT_TOOL_TRANSPORT_MAX_CHARS &&
    candidate.length - markerChars <= AGENT_MESSAGE_MAX_CHARS &&
    toModelText(candidate).length <= AGENT_MESSAGE_MAX_CHARS;

  const markerOnly = buildTraceTransport(segments, 0);
  if (!isValid(markerOnly)) return null;

  let low = 0;
  let high = Math.min(narrationChars, AGENT_MESSAGE_MAX_CHARS);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (isValid(buildTraceTransport(segments, middle))) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return buildTraceTransport(segments, low);
}

function entriesForTransport(entries: ChatEntry[]): AgentChatMessage[] {
  return entries.flatMap((entry) => {
    if (entry.role === "user") return [entry];
    const content = assistantContentForTransport(entry.content);
    return content === null ? [] : [{ role: "assistant", content }];
  });
}

function executorError(error: unknown): CallResultEnvelope {
  return callErrorEnvelope(
    error instanceof Error && error.message
      ? error.message
      : "The tool could not run.",
  );
}

export function useAgentChat({
  clubSlug,
  agentId,
  versionId,
  executors = EMPTY_EXECUTORS,
  fallbackExecutor = DEFAULT_FALLBACK_EXECUTOR,
}: UseAgentChatOptions): {
  entries: ChatEntry[];
  send: (text: string) => Promise<void>;
  busy: boolean;
  reset: () => void;
  rawResults: Map<RawResultKey, string>;
} {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [rawResults, setRawResults] = useState<Map<RawResultKey, string>>(
    () => new Map(),
  );
  const [busy, setBusy] = useState(false);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;

      const userEntry: ChatEntry = { role: "user", content };
      const history = [...entries, userEntry];
      const transportHistory = entriesForTransport(history);
      const assistantIndex = history.length;
      let assistantAdded = false;
      let assistantText = "";
      setEntries(history);
      setBusy(true);

      const appendAssistant = (delta: string) => {
        assistantText += delta;
        setEntries((current) => {
          const next = [...current];
          const assistant = next[assistantIndex];
          if (assistant?.role === "assistant") {
            next[assistantIndex] = { ...assistant, content: assistantText };
          }
          return next;
        });
      };

      const streamTurn = async (
        messages: Array<{
          role: "user" | "assistant" | "data";
          content: string;
        }>,
        continuation: boolean,
      ) => {
        const response = await fetch(
          `/clubs/${encodeURIComponent(clubSlug)}/api/agents/${encodeURIComponent(agentId)}/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              versionId,
              messages,
              ...(continuation ? { continuation: true } : {}),
            }),
          },
        );
        if (!response.ok || !response.body) throw new Error(NOT_REACHABLE);

        if (!assistantAdded) {
          assistantAdded = true;
          setEntries((current) => [
            ...current,
            { role: "assistant", content: "" },
          ]);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let firstDelta = true;
        while (true) {
          const { done, value } = await reader.read();
          const decoded = decoder.decode(value, { stream: !done });
          if (decoded) {
            const separator =
              continuation &&
              firstDelta &&
              assistantText &&
              !assistantText.endsWith("\n\n")
                ? "\n\n"
                : "";
            appendAssistant(separator + decoded);
            firstDelta = false;
          }
          if (done) break;
        }
      };

      const continuationMessages = (
        assistantContent: string,
        tool: string,
        envelope: CallResultEnvelope,
      ): AgentChatMessage[] | null => {
        const assistantTransport =
          assistantContentForTransport(assistantContent);
        if (assistantTransport === null) return null;
        const messages: AgentChatMessage[] = [
          ...transportHistory,
          { role: "assistant", content: assistantTransport },
          {
            role: "data",
            content: JSON.stringify({ tool, envelope }),
          },
        ];
        return "error" in
          parseAgentChatRequest({
            versionId,
            continuation: true,
            messages,
          })
          ? null
          : messages;
      };

      try {
        await streamTurn(transportHistory, false);

        for (
          let callCount = 1;
          callCount <= WORKBENCH_MAX_CONTINUATIONS;
          callCount++
        ) {
          const last = splitToolNotes(assistantText).at(-1);
          if (last?.type !== "call") break;

          if (callCount < WORKBENCH_MAX_CONTINUATIONS) {
            const preflight = continuationMessages(
              `${assistantText}\n\n${callResultNote(MAX_CONTINUATION_ENVELOPE)}`,
              last.tool,
              MAX_CONTINUATION_ENVELOPE,
            );
            if (preflight === null) {
              const safeStopEnvelope = callErrorEnvelope(UNSAFE_TOOL_CALL);
              appendAssistant(
                `\n\n${callResultNote(safeStopEnvelope)}\n\n${UNSAFE_TOOL_CALL}`,
              );
              break;
            }
          }

          const executor = executors[last.tool] ?? fallbackExecutor;
          let execution: Awaited<ReturnType<ToolExecutor>>;
          try {
            execution = await executor({
              tool: last.tool,
              args: last.args,
            });
          } catch (error) {
            execution = { envelope: executorError(error) };
          }

          const resultIndex = splitToolNotes(assistantText).filter(
            (segment) => segment.type === "callresult",
          ).length;
          appendAssistant(`\n\n${callResultNote(execution.envelope)}`);
          if ("raw" in execution && typeof execution.raw === "string") {
            setRawResults((current) => {
              const next = new Map(current);
              next.set(
                rawResultKey(assistantIndex, resultIndex),
                execution.raw,
              );
              return next;
            });
          }

          if (callCount === WORKBENCH_MAX_CONTINUATIONS) {
            appendAssistant("\n\nStopped after 5 tool calls in a row.");
            break;
          }

          const messages = continuationMessages(
            assistantText,
            last.tool,
            execution.envelope,
          );
          if (messages === null) {
            appendAssistant(`\n\n${UNSAFE_CONTINUATION}`);
            break;
          }

          await streamTurn(messages, true);
        }
      } catch {
        if (assistantAdded) {
          appendAssistant(
            `${assistantText.endsWith("\n\n") ? "" : "\n\n"}${NOT_REACHABLE}`,
          );
        } else {
          setEntries((current) => [
            ...current,
            { role: "assistant", content: NOT_REACHABLE },
          ]);
        }
      } finally {
        setBusy(false);
      }
    },
    [
      agentId,
      busy,
      clubSlug,
      entries,
      executors,
      fallbackExecutor,
      versionId,
    ],
  );

  const reset = useCallback(() => {
    setEntries([]);
    setRawResults(new Map());
  }, []);

  return { entries, send, busy, reset, rawResults };
}
