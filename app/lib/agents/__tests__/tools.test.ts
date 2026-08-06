import { delegationFor, runToolCall } from "@vibegarden/agent-core";
import { callNote, callResultNote, capCallResult } from "@vibegarden/agent-web";
import { describe, expect, it } from "vitest";

import { emptyDefinition } from "../contracts";
import { historyForModel } from "../chat-request";
import { agentToolSpecs } from "../tools.server";

const call = (name: string, args: Record<string, unknown>) => ({
  id: "call-1",
  name,
  arguments: JSON.stringify(args),
});

describe("agentToolSpecs", () => {
  it("offers definition tools and enabled builtins", () => {
    const definition = {
      ...emptyDefinition(),
      tools: [
        {
          name: "extract_text",
          description: "Extract readable text from HTML.",
          parameters: {
            type: "object",
            properties: { html: { type: "string" } },
          },
          source: "return args.html;",
        },
      ],
    };

    expect(agentToolSpecs(definition).map((spec) => spec.name)).toEqual([
      "extract_text",
      "fetch_page",
      "remember",
      "recall",
    ]);
    expect(
      agentToolSpecs({
        ...definition,
        builtins: { fetchPage: false, memory: false },
      }).map((spec) => spec.name),
    ).toEqual(["extract_text"]);
  });

  it("delegates a definition tool with its raw arguments", () => {
    const definition = {
      ...emptyDefinition(),
      tools: [
        {
          name: "extract_text",
          description: "Extract readable text from HTML.",
          parameters: { type: "object" },
          source: "return args.html;",
        },
      ],
      builtins: { fetchPage: false, memory: false },
    };
    const specs = agentToolSpecs(definition);
    const args = { html: "<p>Hello</p>", selector: 42 };

    expect(delegationFor(specs, call("extract_text", args))).toEqual({
      tool: "extract_text",
      payload: args,
    });
    expect(specs[0]?.noteFor?.(args)).toBeNull();
  });

  it("refuses an HTTP fetch through tool mechanics", async () => {
    const specs = agentToolSpecs({
      ...emptyDefinition(),
      builtins: { fetchPage: true, memory: false },
    });
    const httpCall = call("fetch_page", { url: "http://example.com/page" });

    expect(delegationFor(specs, httpCall)).toBeNull();
    expect(await runToolCall(specs, httpCall)).toMatch(/^Error:/);
    expect(
      delegationFor(
        specs,
        call("fetch_page", { url: "https://example.com/page" }),
      ),
    ).toEqual({
      tool: "fetch_page",
      payload: { url: "https://example.com/page" },
    });
  });

  it("validates delegated memory payload lengths", async () => {
    const specs = agentToolSpecs({
      ...emptyDefinition(),
      builtins: { fetchPage: false, memory: true },
    });

    expect(
      delegationFor(specs, call("remember", { key: "topic", value: "ducks" })),
    ).toEqual({
      tool: "remember",
      payload: { op: "remember", key: "topic", value: "ducks" },
    });
    expect(delegationFor(specs, call("recall", {}))).toEqual({
      tool: "recall",
      payload: { op: "recall" },
    });

    const oversized = call("remember", {
      key: "k".repeat(81),
      value: "v".repeat(501),
    });
    expect(delegationFor(specs, oversized)).toBeNull();
    expect(await runToolCall(specs, oversized)).toMatch(/^Error:/);
  });
});

describe("historyForModel", () => {
  it("renders a re-capped continuation result as a user message", () => {
    const raw = "x".repeat(5_000);
    const history = historyForModel([
      { role: "user", content: "Fetch the page" },
      {
        role: "data",
        content: JSON.stringify({
          tool: "fetch_page",
          envelope: {
            status: "ok",
            resultText: raw,
            totalChars: raw.length,
            truncated: false,
          },
        }),
      },
    ]);

    expect(history).toEqual([
      { role: "user", content: "Fetch the page" },
      {
        role: "user",
        content: `Tool result for fetch_page:\n${"x".repeat(4_000)}`,
      },
    ]);
  });

  it("renders tool errors and compacts assistant trace markers", () => {
    const history = historyForModel([
      {
        role: "assistant",
        content: `${callNote({ tool: "fetch_page", args: { url: "https://example.com" } })}\n\n${callResultNote(capCallResult("page text"))}`,
      },
      {
        role: "data",
        content: JSON.stringify({
          tool: "extract_text",
          envelope: { status: "error", error: "runner failed" },
        }),
      },
    ]);

    expect(history).toEqual([
      {
        role: "assistant",
        content:
          '[ran fetch_page: {"url":"https://example.com"}]\n\n[fetch_page result: ok, 9 chars]',
      },
      {
        role: "user",
        content: "Tool result for extract_text:\nError: runner failed",
      },
    ]);
  });
});
