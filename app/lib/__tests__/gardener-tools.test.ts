import { describe, expect, it } from "vitest";
import {
  noteEventFor,
  openAiToolDefinitions,
  runToolCall,
} from "@vibegarden/agent-core";
import {
  gardenerToolSpecs,
  htmlToText,
  offeredGardenerTools,
} from "~/lib/gardener-tools.server";
import { markerForEvent } from "@vibegarden/agent-web";

const call = (name: string, args: object) => ({
  id: "call_1",
  name,
  arguments: JSON.stringify(args),
});

const config = {};
const specs = gardenerToolSpecs(config);

const execute = (c: { id: string; name: string; arguments: string }) =>
  runToolCall(specs, c);

/** The web marker for a call's activity note, as the chat route emits it. */
const noteMarker = (c: { id: string; name: string; arguments: string }) => {
  const event = noteEventFor(specs, c);
  return event ? markerForEvent(event) : null;
};

describe("gardener tool execution", () => {
  it("offers a required titled Mermaid visualization tool", () => {
    const definition = openAiToolDefinitions(offeredGardenerTools(config)).find(
      (item) => item.function.name === "visualize_flow",
    );
    expect(definition).toMatchObject({
      type: "function",
      function: {
        name: "visualize_flow",
        parameters: {
          type: "object",
          required: ["title", "diagram"],
          properties: {
            title: { type: "string" },
            diagram: { type: "string" },
          },
        },
      },
    });
    expect(definition?.function.description).toContain(
      "Never return the Mermaid source as chat text or a code block",
    );
  });

  it("gates fresh_reads on the token and always offers query_data", () => {
    const names = (offered: { name: string }[]) => offered.map((s) => s.name);
    expect(names(offeredGardenerTools(config))).toEqual([
      "read_article",
      "recommend_articles",
      "read_module",
      "fetch_page",
      "visualize_flow",
      "attach_data",
      "query_data",
    ]);
    expect(
      names(
        offeredGardenerTools(
          { freshReads: { token: "token" } },
        ),
      ),
    ).toContain("fresh_reads");
    expect(names(offeredGardenerTools(config))).toContain("query_data");
  });

  it("reads an article without its frontmatter", async () => {
    const result = await execute(call("read_article", { slug: "what-is-an-llm" }));
    expect(result).toContain("A very good guesser");
    expect(result).not.toMatch(/^---/);
  });

  it("offers and renders one to three known learning recommendations", async () => {
    const definition = openAiToolDefinitions(offeredGardenerTools(config)).find(
      (item) => item.function.name === "recommend_articles",
    );
    expect(definition).toMatchObject({
      function: {
        parameters: {
          required: ["slugs"],
          properties: { slugs: { type: "array", maxItems: 3 } },
        },
      },
    });

    const recommendations = call("recommend_articles", {
      slugs: ["what-is-an-llm", "what-is-an-agent", "what-is-an-agent"],
    });
    const result = await execute(recommendations);
    expect(result).toContain("[What is an LLM, really?](/learning/what-is-an-llm)");
    expect(result).toContain("[What is an agent?](/learning/what-is-an-agent)");
    expect(noteMarker(recommendations)).toContain("[[tool:articles:");
  });

  it("rejects unknown or empty learning recommendations without a marker", async () => {
    for (const slugs of [[], ["not-a-real-article"]]) {
      const recommendations = call("recommend_articles", { slugs });
      expect(await execute(recommendations)).toContain("Error");
      expect(noteMarker(recommendations)).toBeNull();
    }
  });

  it("lists valid slugs when the article is unknown", async () => {
    const result = await execute(call("read_article", { slug: "nope" }));
    expect(result).toContain("Error");
    expect(result).toContain("what-is-an-llm");
  });

  it("reads a building block", async () => {
    const result = await execute(call("read_module", { slug: "google-sheet" }));
    expect(result).toContain("Setup steps");
  });

  it("lists valid slugs when the block is unknown", async () => {
    const result = await execute(call("read_module", { slug: "nope" }));
    expect(result).toContain("Error");
    expect(result).toContain("csv-file");
  });

  it("rejects non-http URLs and invalid JSON args", async () => {
    expect(
      await execute(call("fetch_page", { url: "file:///etc/passwd" })),
    ).toContain("only http(s)");
    expect(await execute(call("fetch_page", { url: "not a url" }))).toContain(
      "not a valid URL",
    );
    expect(
      await execute({ id: "x", name: "fetch_page", arguments: "{oops" }),
    ).toContain("not valid JSON");
  });

  it("fails softly when fresh_reads has no token", async () => {
    expect(await execute(call("fresh_reads", {}))).toContain("not reachable");
  });

  it("rejects unknown tools", async () => {
    expect(await execute(call("rm_rf", {}))).toContain("unknown tool");
  });

  it("acknowledges and emits a diagram for a valid flow", async () => {
    const flow = call("visualize_flow", {
      title: " Request flow ",
      diagram: " flowchart TD\n  A --> B ",
    });
    expect(await execute(flow)).toBe(
      'Diagram "Request flow" is ready. Briefly explain what it shows.',
    );
    expect(noteMarker(flow)).toContain("[[tool:diagram:");
  });

  it("rejects empty and oversized flows without emitting a marker", async () => {
    const empty = call("visualize_flow", {
      title: "",
      diagram: "flowchart TD",
    });
    expect(await execute(empty)).toContain("title is required");
    expect(noteMarker(empty)).toBeNull();

    const oversized = call("visualize_flow", {
      title: "Large flow",
      diagram: "x".repeat(12_001),
    });
    expect(await execute(oversized)).toContain("12,000 characters");
    expect(noteMarker(oversized)).toBeNull();
  });

  it("rejects Mermaid data charts, steering them to query_data", async () => {
    for (const diagram of [
      "xychart-beta\n  x-axis [2001, 2002]\n  bar [1, 7]",
      "linechart\n  x: year\n  y: avg_score",
      "barchart\n  x: dept\n  y: salary",
    ]) {
      const chart = call("visualize_flow", { title: "Data chart", diagram });
      expect(await execute(chart)).toContain("query_data");
      expect(noteMarker(chart)).toBeNull();
    }
  });

  it("still allows a genuine flowchart", async () => {
    const flow = call("visualize_flow", {
      title: "Pipeline",
      diagram: "flowchart LR\n  A --> B --> C",
    });
    expect(await execute(flow)).toContain("is ready");
    expect(noteMarker(flow)).toContain("[[tool:diagram:");
  });
});

describe("htmlToText", () => {
  it("strips tags, scripts, and entities", () => {
    const text = htmlToText(
      "<html><head><style>p{color:red}</style><script>alert(1)</script></head>" +
        "<body><h1>Title</h1><p>One &amp; two.</p><p>Three</p></body></html>",
    );
    expect(text).toBe("Title\nOne & two.\nThree");
  });
});

describe("activity notes", () => {
  it("emits a card note for a known article or module", () => {
    expect(noteMarker(call("read_article", { slug: "what-is-an-llm" }))).toBe(
      "[[tool:article:what-is-an-llm]]",
    );
    expect(noteMarker(call("read_module", { slug: "google-sheet" }))).toBe(
      "[[tool:module:google-sheet]]",
    );
  });

  it("falls back to a plain note for unknown slugs and pages", () => {
    expect(noteMarker(call("read_article", { slug: "nope" }))).toBe(
      "[[tool:note:looking for an article]]",
    );
    expect(noteMarker(call("fetch_page", { url: "https://example.com/x" }))).toBe(
      "[[tool:web:example.com]]",
    );
    expect(noteMarker(call("fetch_page", { url: "not a url" }))).toBe(
      "[[tool:note:fetching a page]]",
    );
  });

  it("defaults to a 'using' note for tools without their own", () => {
    expect(noteMarker(call("query_data", { sql: "SELECT 1" }))).toBe(
      "[[tool:note:using query_data]]",
    );
  });
});
