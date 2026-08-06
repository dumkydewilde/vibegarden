import { describe, expect, it } from "vitest";
import {
  CALL_ERROR_MAX_CHARS,
  CALL_RESULT_MAX_CHARS,
  callErrorEnvelope,
  callNote,
  callResultNote,
  callSummaryLine,
  capCallResult,
  markerForEvent,
  parseCallResultEnvelope,
  proposalNote,
  splitToolNotes,
  toModelText,
} from "@vibegarden/agent-web";

describe("call result envelopes", () => {
  it("caps result text and reports its original size", () => {
    const raw = "x".repeat(CALL_RESULT_MAX_CHARS + 17);

    expect(capCallResult(raw)).toEqual({
      status: "ok",
      resultText: "x".repeat(CALL_RESULT_MAX_CHARS),
      totalChars: CALL_RESULT_MAX_CHARS + 17,
      truncated: true,
    });
    expect(capCallResult("small")).toEqual({
      status: "ok",
      resultText: "small",
      totalChars: 5,
      truncated: false,
    });
  });

  it("caps error messages at the error budget", () => {
    const message = "e".repeat(CALL_ERROR_MAX_CHARS + 1);

    expect(callErrorEnvelope(message)).toEqual({
      status: "error",
      error: "e".repeat(CALL_ERROR_MAX_CHARS),
    });
  });

  it("round-trips valid ok and error envelopes", () => {
    const ok = capCallResult("extracted text");
    const error = callErrorEnvelope("Error: selector did not match");

    expect(parseCallResultEnvelope(JSON.stringify(ok))).toEqual(ok);
    expect(parseCallResultEnvelope(JSON.stringify(error))).toEqual(error);
  });

  it("re-caps an oversized client result", () => {
    const resultText = "x".repeat(CALL_RESULT_MAX_CHARS + 500);

    expect(
      parseCallResultEnvelope(
        JSON.stringify({
          status: "ok",
          resultText,
          totalChars: resultText.length,
          truncated: false,
        }),
      ),
    ).toEqual({
      status: "ok",
      resultText: "x".repeat(CALL_RESULT_MAX_CHARS),
      totalChars: resultText.length,
      truncated: true,
    });
  });

  it("rejects garbage and malformed envelopes", () => {
    expect(parseCallResultEnvelope("not json")).toBeNull();
    expect(
      parseCallResultEnvelope(JSON.stringify({ status: "ok" })),
    ).toBeNull();
    expect(
      parseCallResultEnvelope(JSON.stringify({ status: "error" })),
    ).toBeNull();
  });

  it("rejects envelopes with unknown top-level keys", () => {
    expect(
      parseCallResultEnvelope(
        JSON.stringify({ ...capCallResult("page text"), padding: "ignored" }),
      ),
    ).toBeNull();
    expect(
      parseCallResultEnvelope(
        JSON.stringify({ ...callErrorEnvelope("denied"), padding: "ignored" }),
      ),
    ).toBeNull();
  });
});

describe("call markers", () => {
  it("round-trips a call and its result in stream order", () => {
    const request = {
      tool: "extract_text",
      args: { selector: "main", readable: true },
    };
    const result = capCallResult("Hello world");
    const text = [
      "I will inspect the page.",
      callNote(request),
      callResultNote(result),
      "The page says hello.",
    ].join("\n\n");

    expect(splitToolNotes(text)).toEqual([
      { type: "text", text: "I will inspect the page." },
      { type: "call", ...request },
      { type: "callresult", result },
      { type: "text", text: "The page says hello." },
    ]);
  });

  it("keeps malformed call markers as text", () => {
    expect(splitToolNotes("[[tool:call:not-json]]")).toEqual([
      { type: "text", text: "[[tool:call:not-json]]" },
    ]);
    expect(splitToolNotes("[[tool:callresult:not-json]]")).toEqual([
      { type: "text", text: "[[tool:callresult:not-json]]" },
    ]);
  });

  it.each([
    [
      "call",
      {
        version: 1,
        tool: "extract_text",
        args: {},
        padding: "x".repeat(8_000),
      },
    ],
    [
      "callresult",
      {
        ...capCallResult("page text"),
        padding: "x".repeat(8_000),
      },
    ],
  ])("keeps padded %s markers as text", (kind, payload) => {
    const marker = `[[tool:${kind}:${encodeURIComponent(JSON.stringify(payload))}]]`;

    expect(splitToolNotes(marker)).toEqual([{ type: "text", text: marker }]);
  });

  it("compacts a call and result to one line each", () => {
    const result = capCallResult("Hello world");
    const text = [
      callNote({
        tool: "extract_text",
        args: { selector: "main", readable: true },
      }),
      callResultNote(result),
    ].join("\n");

    expect(toModelText(text)).toBe(
      [
        '[ran extract_text: {"selector":"main","readable":true}]',
        "[extract_text result: ok, 11 chars]",
      ].join("\n\n"),
    );
    expect(callSummaryLine("extract_text", callErrorEnvelope("denied"))).toBe(
      "[extract_text result: error: denied]",
    );
  });

  it("normalizes line-breaking error whitespace before capping the summary", () => {
    expect(
      callSummaryLine(
        "extract_text",
        callErrorEnvelope("first line\nsecond line\r\nthird line\u2028fourth line"),
      ),
    ).toBe(
      "[extract_text result: error: first line second line third line fourth line]",
    );
    expect(
      callSummaryLine(
        "extract_text",
        callErrorEnvelope(`${"a".repeat(198)}\r\nb`),
      ),
    ).toBe(`[extract_text result: error: ${"a".repeat(198)} b]`);
  });

  it("caps compacted argument JSON at 300 characters", () => {
    const compacted = toModelText(
      callNote({ tool: "extract_text", args: { text: "x".repeat(500) } }),
    );

    expect(compacted).toBe(
      `[ran extract_text: ${JSON.stringify({ text: "x".repeat(500) }).slice(0, 300)}]`,
    );
  });

  it("serializes any non-data delegated tool as a call", () => {
    const event = {
      type: "delegated-call" as const,
      tool: "extract_text",
      payload: { selector: "article", limit: 3 },
    };

    expect(markerForEvent(event)).toBe(
      callNote({ tool: event.tool, args: event.payload }),
    );
  });
});

describe("proposal markers", () => {
  it("round-trips a proposed tool and compacts it for model history", () => {
    const proposal = {
      agentId: "agent-article-helper",
      name: "extract_article_text",
      description: "Extracts readable article text from fetched HTML.",
      parameters: {
        type: "object",
        properties: { html: { type: "string" } },
        required: ["html"],
      },
      source: 'return String(args.html ?? "").replace(/<[^>]+>/g, " ");',
      rationale: "Keeps HTML cleanup small and visible in the trace.",
    };
    const marker = proposalNote(proposal);

    expect(splitToolNotes(`Here is a small tool.\n\n${marker}`)).toEqual([
      { type: "text", text: "Here is a small tool." },
      { type: "proposal", ...proposal },
    ]);
    expect(toModelText(marker)).toBe("[proposed tool extract_article_text]");
    expect(
      markerForEvent({ type: "proposal", ...proposal }),
    ).toBe(marker);
  });
});
