import { describe, expect, it } from "vitest";
import {
  diagramNote,
  markerForEvent,
  splitToolNotes,
  stripToolNotes,
  toolNote,
} from "@vibegarden/agent-web";

const diagram = {
  title: "How questions become answers",
  diagram: "flowchart TD\n  A[Question] --> B[Answer]",
};

const articleSlugs = ["what-is-an-llm", "what-is-an-agent"];
const articlesMarker = `[[tool:articles:${encodeURIComponent(
  JSON.stringify({ version: 1, slugs: articleSlugs }),
)}]]`;

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

  it("round-trips a titled multiline diagram", () => {
    const marker = diagramNote(diagram);

    expect(marker).not.toContain("\n");
    expect(splitToolNotes(marker)).toEqual([{ type: "diagram", ...diagram }]);
  });

  it("round-trips a compact learning-article recommendation", () => {
    expect(
      markerForEvent({ type: "articles", slugs: articleSlugs }),
    ).toBe(articlesMarker);
    expect(splitToolNotes(articlesMarker)).toEqual([
      { type: "articles", slugs: articleSlugs },
    ]);
  });

  it("keeps malformed article recommendation markers as text", () => {
    expect(splitToolNotes("[[tool:articles:not-json]]")).toEqual([
      { type: "text", text: "[[tool:articles:not-json]]" },
    ]);
    const tooMany = encodeURIComponent(
      JSON.stringify({ version: 1, slugs: ["a", "b", "c", "d"] }),
    );
    expect(splitToolNotes(`[[tool:articles:${tooMany}]]`)).toEqual([
      { type: "text", text: `[[tool:articles:${tooMany}]]` },
    ]);
  });

  it("keeps malformed and unknown diagram markers as text", () => {
    expect(splitToolNotes("[[tool:diagram:not-json]]")).toEqual([
      { type: "text", text: "[[tool:diagram:not-json]]" },
    ]);
    const future = encodeURIComponent(
      JSON.stringify({
        version: 2,
        title: "Future",
        diagram: "flowchart TD",
      }),
    );
    expect(splitToolNotes(`[[tool:diagram:${future}]]`)).toEqual([
      { type: "text", text: `[[tool:diagram:${future}]]` },
    ]);
  });
});

describe("stripToolNotes", () => {
  it("removes notes and rejoins the text", () => {
    const text = `Before.\n\n${toolNote("module", "csv-file")}\n\nAfter.`;
    expect(stripToolNotes(text)).toBe("Before.\n\nAfter.");
  });

  it("strips a valid diagram marker from model-bound history", () => {
    const text = `Before.\n\n${diagramNote(diagram)}\n\nAfter.`;
    expect(stripToolNotes(text)).toBe("Before.\n\nAfter.");
  });

  it("strips article recommendation cards from model-bound history", () => {
    const text = `Before.\n\n${articlesMarker}\n\nAfter.`;
    expect(stripToolNotes(text)).toBe("Before.\n\nAfter.");
  });
});
