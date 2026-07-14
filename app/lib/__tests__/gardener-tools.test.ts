import { describe, expect, it } from "vitest";
import {
  describeToolCall,
  executeTool,
  htmlToText,
} from "~/lib/gardener-tools.server";

const call = (name: string, args: object) => ({
  id: "call_1",
  name,
  arguments: JSON.stringify(args),
});

describe("executeTool", () => {
  it("reads an article without its frontmatter", async () => {
    const result = await executeTool(
      call("read_article", { slug: "what-is-an-llm" }),
    );
    expect(result).toContain("A very good guesser");
    expect(result).not.toMatch(/^---/);
  });

  it("lists valid slugs when the article is unknown", async () => {
    const result = await executeTool(call("read_article", { slug: "nope" }));
    expect(result).toContain("Error");
    expect(result).toContain("what-is-an-llm");
  });

  it("reads a building block", async () => {
    const result = await executeTool(
      call("read_module", { slug: "google-sheet" }),
    );
    expect(result).toContain("Setup steps");
  });

  it("lists valid slugs when the block is unknown", async () => {
    const result = await executeTool(call("read_module", { slug: "nope" }));
    expect(result).toContain("Error");
    expect(result).toContain("csv-file");
  });

  it("rejects non-http URLs and invalid JSON args", async () => {
    expect(await executeTool(call("fetch_page", { url: "file:///etc/passwd" })))
      .toContain("only http(s)");
    expect(await executeTool(call("fetch_page", { url: "not a url" })))
      .toContain("not a valid URL");
    expect(
      await executeTool({ id: "x", name: "fetch_page", arguments: "{oops" }),
    ).toContain("not valid JSON");
  });

  it("rejects unknown tools", async () => {
    expect(await executeTool(call("rm_rf", {}))).toContain("unknown tool");
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

describe("describeToolCall", () => {
  it("names the article being read", () => {
    expect(
      describeToolCall(call("read_article", { slug: "what-is-an-llm" })),
    ).toBe('reading "What is an LLM, really?"');
  });

  it("names the host being fetched", () => {
    expect(
      describeToolCall(call("fetch_page", { url: "https://example.com/x" })),
    ).toBe("reading example.com");
  });
});
