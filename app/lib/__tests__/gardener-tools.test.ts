import { describe, expect, it } from "vitest";
import {
  executeTool,
  htmlToText,
  toolNoteFor,
} from "~/lib/gardener-tools.server";

const call = (name: string, args: object) => ({
  id: "call_1",
  name,
  arguments: JSON.stringify(args),
});

const env = {} as Env;

describe("executeTool", () => {
  it("reads an article without its frontmatter", async () => {
    const result = await executeTool(
      call("read_article", { slug: "what-is-an-llm" }),
      env,
    );
    expect(result).toContain("A very good guesser");
    expect(result).not.toMatch(/^---/);
  });

  it("lists valid slugs when the article is unknown", async () => {
    const result = await executeTool(call("read_article", { slug: "nope" }), env);
    expect(result).toContain("Error");
    expect(result).toContain("what-is-an-llm");
  });

  it("reads a building block", async () => {
    const result = await executeTool(
      call("read_module", { slug: "google-sheet" }),
      env,
    );
    expect(result).toContain("Setup steps");
  });

  it("lists valid slugs when the block is unknown", async () => {
    const result = await executeTool(call("read_module", { slug: "nope" }), env);
    expect(result).toContain("Error");
    expect(result).toContain("csv-file");
  });

  it("rejects non-http URLs and invalid JSON args", async () => {
    expect(
      await executeTool(call("fetch_page", { url: "file:///etc/passwd" }), env),
    ).toContain("only http(s)");
    expect(
      await executeTool(call("fetch_page", { url: "not a url" }), env),
    ).toContain("not a valid URL");
    expect(
      await executeTool({ id: "x", name: "fetch_page", arguments: "{oops" }, env),
    ).toContain("not valid JSON");
  });

  it("fails softly when fresh_reads has no token", async () => {
    expect(await executeTool(call("fresh_reads", {}), env)).toContain(
      "not reachable",
    );
  });

  it("rejects unknown tools", async () => {
    expect(await executeTool(call("rm_rf", {}), env)).toContain("unknown tool");
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

describe("toolNoteFor", () => {
  it("emits a card note for a known article or module", () => {
    expect(toolNoteFor(call("read_article", { slug: "what-is-an-llm" }))).toBe(
      "[[tool:article:what-is-an-llm]]",
    );
    expect(toolNoteFor(call("read_module", { slug: "google-sheet" }))).toBe(
      "[[tool:module:google-sheet]]",
    );
  });

  it("falls back to a plain note for unknown slugs and pages", () => {
    expect(toolNoteFor(call("read_article", { slug: "nope" }))).toBe(
      "[[tool:note:looking for an article]]",
    );
    expect(
      toolNoteFor(call("fetch_page", { url: "https://example.com/x" })),
    ).toBe("[[tool:web:example.com]]");
    expect(toolNoteFor(call("fetch_page", { url: "not a url" }))).toBe(
      "[[tool:note:fetching a page]]",
    );
  });
});
