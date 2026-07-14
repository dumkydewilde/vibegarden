import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  HISTORY_LIMIT,
  sseToTextStream,
  trimHistory,
} from "~/lib/gardener.server";

describe("buildSystemPrompt", () => {
  it("includes the article index", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("/learning/what-is-an-llm");
    expect(prompt).toContain("The Gardener");
  });

  it("tells the model which page the user is on and not to suggest it", () => {
    const prompt = buildSystemPrompt([], "/learning/what-is-an-llm");
    expect(prompt).toContain('the article "What is an LLM, really?"');
    expect(prompt).toContain("Do not suggest reading this article");
    const home = buildSystemPrompt([], "/garden");
    expect(home).toContain("the Idea Garden (/garden)");
  });

  it("appends context blocks", () => {
    const prompt = buildSystemPrompt([
      { kind: "paragraph", label: "a quote", content: "LLMs are guessers." },
    ]);
    expect(prompt).toContain('<context kind="paragraph"');
    expect(prompt).toContain("LLMs are guessers.");
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
});

describe("sseToTextStream", () => {
  it("extracts deltas and reports the full text", async () => {
    let done = "";
    const stream = sseToTextStream(async (full) => {
      done = full;
    });
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      '',
      ': keep-alive comment',
      'data: [DONE]',
      '',
    ].join("\n");

    const writing = (async () => {
      await writer.write(sse);
      await writer.close();
    })();

    let out = "";
    for (;;) {
      const { done: d, value } = await reader.read();
      if (d) break;
      out += value;
    }
    await writing;
    expect(out).toBe("Hello");
    expect(done).toBe("Hello");
  });
});
