import { describe, expect, it } from "vitest";
import {
  startTurn,
  type AgentEvent,
  type AgentTurnConfig,
  type ToolSpec,
} from "@vibegarden/agent-core";

/** One SSE chat-completion response from the given delta payloads. */
function sseResponse(deltas: object[]): Response {
  const body = [
    ...deltas.map((d) => `data: ${JSON.stringify({ choices: [d] })}`),
    "data: [DONE]",
    "",
  ].join("\n\n");
  return new Response(body, { status: 200 });
}

const textDeltas = (text: string, finish = "stop") => [
  { delta: { content: text } },
  { delta: {}, finish_reason: finish },
];

const toolCallDeltas = (name: string, args: object) => [
  {
    delta: {
      tool_calls: [
        {
          index: 0,
          id: "call_1",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    },
  },
  { delta: {}, finish_reason: "tool_calls" },
];

/**
 * A fetch stub that pops queued responses and records each request body,
 * so tests can assert what traveled upstream per round.
 */
function fakeUpstream(responses: Response[]) {
  const requests: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses.shift();
    if (!next) throw new Error("fakeUpstream ran out of responses");
    return next;
  };
  return { fetchImpl, requests };
}

const echoTool: ToolSpec = {
  name: "echo",
  description: "Echo the input back.",
  parameters: { type: "object", properties: { text: { type: "string" } } },
  execute: (args) => `echoed: ${String(args.text ?? "")}`,
  noteFor: () => ({ type: "note", kind: "note", value: "echoing" }),
};

const runQueryTool: ToolSpec = {
  name: "run_query",
  description: "Delegated to the surface.",
  parameters: { type: "object", properties: { sql: { type: "string" } } },
  delegate: (args) =>
    typeof args.sql === "string" && args.sql ? { sql: args.sql } : null,
  execute: () => "Error: sql is required.",
};

async function collect(
  config: Partial<AgentTurnConfig> & Pick<AgentTurnConfig, "fetchImpl">,
  history = [{ role: "user" as const, content: "hi" }],
) {
  const turn = await startTurn(
    {
      apiKey: "k",
      model: "test/model",
      systemPrompt: "You are a test agent.",
      ...config,
    },
    history,
  );
  if (!turn.ok) return { turn, events: [] as AgentEvent[] };
  const events: AgentEvent[] = [];
  for await (const event of turn.events) events.push(event);
  return { turn, events };
}

describe("startTurn", () => {
  it("streams a plain text turn and finishes", async () => {
    const { fetchImpl, requests } = fakeUpstream([
      sseResponse(textDeltas("Hello there")),
    ]);
    const { events } = await collect({ fetchImpl });

    expect(events).toEqual([
      { type: "text", delta: "Hello there" },
      { type: "done", finishReason: "stop" },
    ]);
    // No tools configured: the request body must not carry a tools key.
    expect(requests[0].tools).toBeUndefined();
    expect(requests[0].model).toBe("test/model");
    const messages = requests[0].messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("returns a plain failure when the first request fails", async () => {
    const { fetchImpl } = fakeUpstream([
      new Response("bad key", { status: 401 }),
    ]);
    const turn = await startTurn(
      {
        apiKey: "k",
        model: "test/model",
        systemPrompt: "s",
        fetchImpl,
      },
      [{ role: "user", content: "hi" }],
    );
    expect(turn).toEqual({ ok: false, status: 401, detail: "bad key" });
  });

  it("runs a tool round: note event, tool result upstream, then text", async () => {
    const { fetchImpl, requests } = fakeUpstream([
      sseResponse(toolCallDeltas("echo", { text: "ping" })),
      sseResponse(textDeltas("It said ping.")),
    ]);
    const { events } = await collect({ fetchImpl, tools: [echoTool] });

    expect(events).toEqual([
      { type: "note", kind: "note", value: "echoing" },
      { type: "text", delta: "It said ping." },
      { type: "done", finishReason: "stop" },
    ]);
    // The second request carries the assistant tool_calls and the result.
    const messages = requests[1].messages as {
      role: string;
      content?: string;
    }[];
    expect(messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
    expect(messages[3].content).toBe("echoed: ping");
  });

  it("withholds tools from the last allowed round", async () => {
    const toolCall = () => sseResponse(toolCallDeltas("echo", { text: "x" }));
    const { fetchImpl, requests } = fakeUpstream([
      toolCall(),
      toolCall(),
      sseResponse(textDeltas("done now")),
    ]);
    const { events } = await collect({
      fetchImpl,
      tools: [echoTool],
      maxToolRounds: 2,
    });

    expect(requests[0].tools).toBeDefined();
    expect(requests[1].tools).toBeDefined();
    expect(requests[2].tools).toBeUndefined();
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  it("ends the turn on a valid delegated call", async () => {
    const { fetchImpl, requests } = fakeUpstream([
      sseResponse(toolCallDeltas("run_query", { sql: "SELECT 1" })),
    ]);
    const { events } = await collect({ fetchImpl, tools: [runQueryTool] });

    expect(events).toEqual([
      { type: "delegated-call", tool: "run_query", payload: { sql: "SELECT 1" } },
      { type: "done", finishReason: "tool_calls" },
    ]);
    expect(requests).toHaveLength(1); // No follow-up round.
  });

  it("sends an invalid delegated call through execute for repair", async () => {
    const { fetchImpl, requests } = fakeUpstream([
      sseResponse(toolCallDeltas("run_query", { sql: "" })),
      sseResponse(textDeltas("Sorry, let me fix that.")),
    ]);
    const { events } = await collect({ fetchImpl, tools: [runQueryTool] });

    expect(events.some((e) => e.type === "delegated-call")).toBe(false);
    const messages = requests[1].messages as {
      role: string;
      content?: string;
    }[];
    expect(messages[3]).toMatchObject({
      role: "tool",
      content: "Error: sql is required.",
    });
  });

  it("emits an upstream error event when a later round fails", async () => {
    const { fetchImpl } = fakeUpstream([
      sseResponse(toolCallDeltas("echo", { text: "x" })),
      new Response("overloaded", { status: 502 }),
    ]);
    const { events } = await collect({ fetchImpl, tools: [echoTool] });

    expect(events.at(-1)).toMatchObject({
      type: "error",
      stage: "upstream",
      status: 502,
      detail: "overloaded",
    });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("turns a mid-stream exception into an error event", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"par"}}]}\n\n',
          ),
        );
        controller.error(new Error("connection reset"));
      },
    });
    const { fetchImpl } = fakeUpstream([new Response(broken, { status: 200 })]);
    const { events } = await collect({ fetchImpl });

    expect(events.at(-1)).toMatchObject({
      type: "error",
      stage: "exception",
    });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });
});
