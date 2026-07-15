import { describe, expect, it } from "vitest";
import { splitToolNotes, stripToolNotes, toolNote } from "~/lib/tool-notes";

describe("splitToolNotes", () => {
  it("passes plain text through as one segment", () => {
    expect(splitToolNotes("Hello **there**\n\nSecond paragraph.")).toEqual([
      { type: "text", text: "Hello **there**\n\nSecond paragraph." },
    ]);
  });

  it("splits text around tool notes in stream order", () => {
    const text = [
      "Let me check.",
      "",
      toolNote("article", "what-is-an-llm"),
      "",
      "An LLM is a very good guesser.",
      toolNote("web", "example.com"),
    ].join("\n");
    expect(splitToolNotes(text)).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool", kind: "article", value: "what-is-an-llm" },
      { type: "text", text: "An LLM is a very good guesser." },
      { type: "tool", kind: "web", value: "example.com" },
    ]);
  });

  it("keeps note text with spaces intact and ignores inline lookalikes", () => {
    expect(splitToolNotes(toolNote("note", "looking for an article"))).toEqual([
      { type: "tool", kind: "note", value: "looking for an article" },
    ]);
    // Not alone on its line: stays part of the text.
    expect(
      splitToolNotes("see [[tool:article:what-is-an-llm]] inline"),
    ).toEqual([
      { type: "text", text: "see [[tool:article:what-is-an-llm]] inline" },
    ]);
  });
});

describe("stripToolNotes", () => {
  it("removes notes and rejoins the text", () => {
    const text = `Before.\n\n${toolNote("module", "csv-file")}\n\nAfter.`;
    expect(stripToolNotes(text)).toBe("Before.\n\nAfter.");
  });
});
