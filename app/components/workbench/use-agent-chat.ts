import { useCallback, useState } from "react";
import {
  callErrorEnvelope,
  callResultNote,
  splitToolNotes,
  type CallResultEnvelope,
} from "@vibegarden/agent-web";

import { WORKBENCH_MAX_CONTINUATIONS } from "~/lib/agents/chat-request";

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
  rawResults: Map<number, string>;
} {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [rawResults, setRawResults] = useState<Map<number, string>>(
    () => new Map(),
  );
  const [busy, setBusy] = useState(false);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;

      const userEntry: ChatEntry = { role: "user", content };
      const history = [...entries, userEntry];
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

      try {
        await streamTurn(history, false);

        for (
          let callCount = 1;
          callCount <= WORKBENCH_MAX_CONTINUATIONS;
          callCount++
        ) {
          const last = splitToolNotes(assistantText).at(-1);
          if (last?.type !== "call") break;

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

          appendAssistant(`\n\n${callResultNote(execution.envelope)}`);
          if ("raw" in execution && typeof execution.raw === "string") {
            setRawResults((current) => {
              const next = new Map(current);
              next.set(assistantIndex, execution.raw);
              return next;
            });
          }

          if (callCount === WORKBENCH_MAX_CONTINUATIONS) {
            appendAssistant("\n\nStopped after 5 tool calls in a row.");
            break;
          }

          await streamTurn(
            [
              ...history,
              { role: "assistant", content: assistantText },
              {
                role: "data",
                content: JSON.stringify({
                  tool: last.tool,
                  envelope: execution.envelope,
                }),
              },
            ],
            true,
          );
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
