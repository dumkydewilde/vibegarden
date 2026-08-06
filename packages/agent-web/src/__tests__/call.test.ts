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
