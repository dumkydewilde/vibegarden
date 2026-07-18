/**
 * Reader for OpenAI-format SSE chat-completion streams (OpenRouter and any
 * compatible endpoint). Runtime-neutral: only web streams, no app imports.
 */

export type ToolCall = {
  id: string;
  name: string;
  /** Raw JSON string, as accumulated from the stream. */
  arguments: string;
};

export type StreamRound = {
  /** Concatenated content deltas of this round. */
  text: string;
  /** Completed tool calls, if the model asked for any. */
  toolCalls: ToolCall[];
  finishReason: string | null;
};

type SseDelta = {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
};

/**
 * Consume one SSE response stream. Content deltas are forwarded to onText
 * as they arrive; tool-call fragments are accumulated by index. Resolves
 * when the stream ends.
 */
export async function readSseRound(
  body: ReadableStream<Uint8Array>,
  onText: (delta: string) => void,
): Promise<StreamRound> {
  const round: StreamRound = { text: "", toolCalls: [], finishReason: null };
  const partial = new Map<number, ToolCall>();

  const handleLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return;
    let parsed: SseDelta;
    try {
      parsed = JSON.parse(data) as SseDelta;
    } catch {
      return; // Ignore malformed SSE lines (comments, keep-alives).
    }
    const choice = parsed.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) round.finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) return;
    if (delta.content) {
      round.text += delta.content;
      onText(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const entry = partial.get(tc.index) ?? {
        id: "",
        name: "",
        arguments: "",
      };
      if (tc.id) entry.id = tc.id;
      if (tc.function?.name) entry.name = tc.function.name;
      if (tc.function?.arguments) entry.arguments += tc.function.arguments;
      partial.set(tc.index, entry);
    }
  };

  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  if (buffer) handleLine(buffer);

  round.toolCalls = [...partial.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call)
    .filter((call) => call.id && call.name);
  return round;
}
