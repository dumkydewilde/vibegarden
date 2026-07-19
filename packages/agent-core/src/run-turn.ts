import type { AgentEvent } from "./events";
import { readSseRound } from "./sse";
import {
  delegationFor,
  noteEventFor,
  openAiToolDefinitions,
  runToolCall,
  type ToolSpec,
} from "./tools";

/**
 * One agent turn against an OpenAI-compatible chat-completion endpoint:
 * up to maxToolRounds of tool execution, then a text answer, produced as
 * an AsyncIterable of AgentEvents. Runtime-neutral (fetch + web streams),
 * no app imports: this file is the heart of the extractable agent core.
 */

export type AgentHistoryMessage = { role: "user" | "assistant"; content: string };

/** Messages as sent upstream; assistant turns may carry tool calls. */
type UpstreamMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type AgentTurnConfig = {
  apiKey: string;
  /** Model id as the endpoint knows it, e.g. an OpenRouter id. */
  model: string;
  systemPrompt: string;
  /** Tools offered to the model; empty (or omitted) for a plain turn. */
  tools?: ToolSpec[];
  /** Tool-execution rounds per turn; after the last, tools are withheld. */
  maxToolRounds?: number;
  /** Chat-completions API root; defaults to OpenRouter. */
  baseUrl?: string;
  /** Extra request headers, e.g. an X-Title for OpenRouter. */
  headers?: Record<string, string>;
  /** Merged into the request body, e.g. OpenRouter plugins. */
  extraBody?: Record<string, unknown>;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
};

export type TurnStart =
  | { ok: false; status: number; detail: string }
  | { ok: true; events: AsyncIterable<AgentEvent> };

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_TOOL_ROUNDS = 3;

/**
 * A tiny unbounded push channel: the pump loop pushes events as upstream
 * bytes arrive, the consumer iterates at its own pace.
 */
function createChannel<T>() {
  const queue: T[] = [];
  let notify: (() => void) | null = null;
  let closed = false;
  const wake = () => {
    notify?.();
    notify = null;
  };
  return {
    push(value: T) {
      if (closed) return;
      queue.push(value);
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (queue.length > 0) yield queue.shift()!;
          if (closed) return;
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
      },
    } as AsyncIterable<T>,
  };
}

/**
 * Start a turn. The first upstream request happens here, so configuration
 * errors surface as a plain failure result the caller can turn into a
 * proper HTTP error instead of a broken stream. On success, iterate
 * `events` for the turn's output; the iterable ends when the turn does.
 */
export async function startTurn(
  config: AgentTurnConfig,
  history: AgentHistoryMessage[],
): Promise<TurnStart> {
  const tools = config.tools ?? [];
  const maxToolRounds = config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  const messages: UpstreamMessage[] = [
    { role: "system", content: config.systemPrompt },
    ...history,
  ];

  const callUpstream = (withTools: boolean) =>
    fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        messages,
        ...(withTools && tools.length > 0
          ? { tools: openAiToolDefinitions(tools) }
          : {}),
        ...config.extraBody,
      }),
    });

  const first = await callUpstream(true);
  if (!first.ok || !first.body) {
    const detail = await first.text().catch(() => "");
    return { ok: false, status: first.status, detail: detail.slice(0, 500) };
  }

  const channel = createChannel<AgentEvent>();

  const pump = async () => {
    let finishReason: string | null = null;
    try {
      let response = first;
      outer: for (let round = 0; ; round++) {
        const result = await readSseRound(response.body!, (delta) =>
          channel.push({ type: "text", delta }),
        );
        finishReason = result.finishReason;
        if (result.toolCalls.length === 0) break;

        messages.push({
          role: "assistant",
          content: result.text || null,
          tool_calls: result.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        });
        for (const call of result.toolCalls) {
          // A delegated tool ends the turn: the surface fulfills the call
          // and resumes with the result. Invalid calls fall through to
          // runToolCall so the model hears what was wrong.
          const delegated = delegationFor(tools, call);
          if (delegated) {
            channel.push({ type: "delegated-call", ...delegated });
            break outer;
          }
          const note = noteEventFor(tools, call);
          if (note) channel.push(note);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: await runToolCall(tools, call),
          });
        }

        // On the last allowed round, withhold tools to force a text answer.
        response = await callUpstream(round + 1 < maxToolRounds);
        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => "");
          channel.push({
            type: "error",
            stage: "upstream",
            status: response.status,
            detail: detail.slice(0, 500),
          });
          return;
        }
      }
      channel.push({ type: "done", finishReason });
    } catch (e) {
      channel.push({
        type: "error",
        stage: "exception",
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      channel.close();
    }
  };
  void pump();

  return { ok: true, events: channel.iterable };
}
