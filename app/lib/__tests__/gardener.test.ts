import { describe, expect, it } from "vitest";
import { readSseRound } from "@vibegarden/agent-core";
import { offeredGardenerTools } from "~/lib/gardener-tools.server";
import {
  buildAudienceSection,
  buildSystemPrompt,
  HISTORY_LIMIT,
  trimHistory,
} from "~/lib/gardener.server";

describe("buildSystemPrompt", () => {
  it("includes the article index", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("/learning/what-is-an-llm");
    expect(prompt).toContain("The Gardener");
  });

  it("includes the inspiration dataset catalog", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("Datasets on the inspiration page");
    expect(prompt).toContain("Open-Meteo weather (Open data");
    expect(prompt).not.toContain("{{DATASETS}}");
  });

  it("tells the model which page the user is on and not to suggest it", () => {
    const prompt = buildSystemPrompt([], "/learning/what-is-an-llm");
    expect(prompt).toContain('the article "What is an LLM, really?"');
    expect(prompt).toContain("Do not suggest reading this article");
    const home = buildSystemPrompt([], "/garden");
    expect(home).toContain("the Idea Garden (/garden)");
  });

  it("knows about building block pages", () => {
    const prompt = buildSystemPrompt([], "/garden/modules/google-sheet");
    expect(prompt).toContain('"Google Sheet" building block page');
  });

  it("describes the tools when the model supports them", () => {
    const withTools = buildSystemPrompt([], undefined, {
      tools: offeredGardenerTools({}),
    });
    expect(withTools).toContain("read_article(slug)");
    expect(withTools).toContain("read_module(slug)");
    expect(withTools).toContain("fetch_page(url)");
    expect(withTools).toContain("attach_data(url)");
    expect(withTools).toContain("visualize_flow(title, diagram)");
    expect(withTools).toContain("directly in the chat");
    expect(withTools).toContain("google-sheet");

    const withoutTools = buildSystemPrompt([], undefined, { tools: [] });
    expect(withoutTools).not.toContain("read_article(slug)");
    expect(withoutTools).toContain("does not support tools");
  });

  it("derives optional tool guidance from the exact offered specs", () => {
    const withFreshReads = buildSystemPrompt([], undefined, {
      tools: offeredGardenerTools({ freshReads: { token: "token" } }),
    });
    expect(withFreshReads).toContain("fresh_reads(topic?, content_type?)");
    expect(withFreshReads).not.toContain("query_data(sql, chart?)");

    const datasets = [{ name: "scores", summary: "scores(id INTEGER)" }];
    const withQueryData = buildSystemPrompt([], undefined, {
      tools: offeredGardenerTools({}, { queryData: true }),
      datasets,
    });
    expect(withQueryData).toContain("query_data(sql, chart?)");
    expect(withQueryData).not.toContain("fresh_reads(topic?, content_type?)");
  });

  it("does not advertise tools on a narration-only dataset turn", () => {
    const prompt = buildSystemPrompt([], undefined, {
      tools: [],
      toolsUnavailableMessage:
        "No tools are available on this continuation. Narrate the query results only.",
      datasets: [{ name: "scores", summary: "scores(id INTEGER)" }],
    });

    expect(prompt).toContain("scores(id INTEGER)");
    expect(prompt).toContain("Narrate the query results only");
    expect(prompt).toContain("no tool is available to read their rows");
    expect(prompt).not.toContain("selected model does not support tools");
    expect(prompt).not.toContain("query_data tool is the only way");
    expect(prompt).not.toContain("read_article(slug)");
    expect(prompt).not.toContain("query_data(sql, chart?)");
  });

  it("weaves in the audience section without frontmatter or placeholder", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("Who tends this garden");
    expect(prompt).toContain("effective altruism");
    expect(prompt).not.toContain("{{AUDIENCE}}");
    expect(prompt).not.toContain("enabled:");
    expect(prompt).not.toContain("\n\n\n");
  });

  it("appends context blocks", () => {
    const prompt = buildSystemPrompt([
      { kind: "paragraph", label: "a quote", content: "LLMs are guessers." },
    ]);
    expect(prompt).toContain('<context kind="paragraph"');
    expect(prompt).toContain("LLMs are guessers.");
  });
});

describe("buildAudienceSection", () => {
  it("strips the frontmatter and keeps the body", () => {
    const section = buildAudienceSection();
    expect(section).toContain("Who tends this garden");
    expect(section).not.toContain("---");
  });
});

describe("trimHistory", () => {
  it("keeps only the most recent messages", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
    }));
    const trimmed = trimHistory(many);
    expect(trimmed.length).toBe(HISTORY_LIMIT);
    expect(trimmed[trimmed.length - 1].content).toBe("msg 99");
  });

  it("strips tool notes from assistant turns, not user turns", () => {
    const trimmed = trimHistory([
      {
        role: "assistant",
        content: "Sure.\n\n[[tool:article:what-is-an-llm]]\n\nHere it is.",
      },
      { role: "user", content: "[[tool:article:keep-me]]" },
    ]);
    expect(trimmed[0].content).toBe("Sure.\n\nHere it is.");
    expect(trimmed[1].content).toBe("[[tool:article:keep-me]]");
  });

  it("gives query and attach data messages their own instructions", () => {
    const query = trimHistory([
      {
        role: "data",
        content: JSON.stringify({
          status: "ok",
          columns: ["n"],
          rows: [[1]],
          rowCount: 1,
          truncated: false,
        }),
      },
    ]);
    expect(query[0].role).toBe("user");
    expect(query[0].content).toContain("<query_results>");

    const attach = trimHistory([
      {
        role: "data",
        content: JSON.stringify({
          kind: "attach",
          status: "ok",
          name: "forecast",
          label: "forecast.json",
          rowCount: 48,
          summary: 'Table "forecast" (48 rows)',
        }),
      },
    ]);
    expect(attach[0].role).toBe("user");
    expect(attach[0].content).toContain("<attach_result>");
    expect(attach[0].content).toContain("attach_data");
  });
});

/** Byte stream from string chunks, to exercise buffering across boundaries. */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readSseRound", () => {
  it("extracts text deltas and the finish reason", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      "",
      ": keep-alive comment",
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    let out = "";
    // Split mid-line to prove buffering works.
    const round = await readSseRound(
      sseStream([sse.slice(0, 25), sse.slice(25)]),
      (t) => {
        out += t;
      },
    );
    expect(out).toBe("Hello");
    expect(round.text).toBe("Hello");
    expect(round.toolCalls).toEqual([]);
    expect(round.finishReason).toBe("stop");
  });

  it("accumulates tool calls split across deltas", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_article","arguments":""}}]}}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"slug\\":"}}]}}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"what-is-an-llm\\"}"}}]}}]}',
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    let out = "";
    const round = await readSseRound(sseStream([sse]), (t) => {
      out += t;
    });
    expect(out).toBe("");
    expect(round.finishReason).toBe("tool_calls");
    expect(round.toolCalls).toEqual([
      {
        id: "call_1",
        name: "read_article",
        arguments: '{"slug":"what-is-an-llm"}',
      },
    ]);
  });

  it("drops incomplete tool calls without id or name", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const round = await readSseRound(sseStream([sse]), () => {});
    expect(round.toolCalls).toEqual([]);
  });
});
