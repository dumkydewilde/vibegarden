import { useCallback, useState } from "react";

export type ChatEntry = {
  role: "user" | "assistant";
  content: string;
};

type UseAgentChatOptions = {
  clubSlug: string;
  agentId: string;
  versionId: string;
};

const NOT_REACHABLE = "The language model is not reachable right now.";

export function useAgentChat({
  clubSlug,
  agentId,
  versionId,
}: UseAgentChatOptions): {
  entries: ChatEntry[];
  send: (text: string) => Promise<void>;
  busy: boolean;
  reset: () => void;
} {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;

      const userEntry: ChatEntry = { role: "user", content };
      const history = [...entries, userEntry];
      setEntries(history);
      setBusy(true);

      try {
        const response = await fetch(
          `/clubs/${encodeURIComponent(clubSlug)}/api/agents/${encodeURIComponent(agentId)}/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ versionId, messages: history }),
          },
        );
        if (!response.ok || !response.body) throw new Error(NOT_REACHABLE);

        setEntries((current) => [
          ...current,
          { role: "assistant", content: "" },
        ]);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          const delta = decoder.decode(value, { stream: !done });
          if (delta) {
            setEntries((current) => {
              const next = [...current];
              const last = next.at(-1);
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + delta,
                };
              }
              return next;
            });
          }
          if (done) break;
        }
      } catch {
        setEntries((current) => [
          ...current,
          { role: "assistant", content: NOT_REACHABLE },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [agentId, busy, clubSlug, entries, versionId],
  );

  const reset = useCallback(() => setEntries([]), []);

  return { entries, send, busy, reset };
}
