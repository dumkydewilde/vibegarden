import { describe, expect, it } from "vitest";
import { getArticleRaw, getArticles } from "~/lib/content";
import { getModuleRaw, getModules } from "~/lib/modules";
import {
  GUIDANCE_RELATED_MAX,
  presentGuidance,
  presentLibraryGuide,
} from "~/lib/mcp/content-presenter";
import { BODY_MAX_CHARS } from "~/lib/mcp/contracts";

const appOrigin = "https://vibegarden.test";
const library = {
  appOrigin,
  clubSlug: "wotf",
  getArticles,
  getModules,
  getArticleRaw,
  getModuleRaw,
};

function guidance(question: string, overrides: Record<string, unknown> = {}) {
  return presentGuidance({ ...library, question, ...overrides });
}

function slugs(result: ReturnType<typeof guidance>) {
  return result.items.map((item) => item.slug);
}

describe("MCP guidance presenter", () => {
  it("answers the workshop's real questions from the shipped library", () => {
    expect(slugs(guidance("how do I host my data and images?")))
      .toContain("hosting-files-and-assets");
    expect(slugs(guidance("how do I call an API with a key?")))
      .toContain("calling-an-api");
    expect(slugs(guidance("how do I vibe code with a coding agent?")))
      .toContain("working-with-a-coding-agent");
    expect(slugs(guidance("where do I put my app so it has a URL?")))
      .toContain("hosting-your-app");
  });

  it("ranks a title match above a passing mention and keeps the rest as related", () => {
    const result = guidance("scheduled task");

    expect(result.items[0].slug).toBe("scheduled-task");
    expect(result.items.length).toBeLessThanOrEqual(3);
    expect(result.related.length).toBeGreaterThan(0);
    expect(result.related.map((item) => item.slug))
      .not.toContain(result.items[0].slug);
  });

  it("stems the question so plurals and gerunds still match", () => {
    expect(slugs(guidance("storing files"))).toContain("file-store");
    expect(slugs(guidance("generate images"))).toContain("generating-images");
  });

  it("returns only the requested kind", () => {
    const result = guidance("database", { kind: "module" });

    expect(result.items.length).toBeGreaterThan(0);
    for (const item of [...result.items, ...result.related]) {
      expect(item.kind).toBe("module");
    }
  });

  it("excerpts the matching sections rather than the opening lines", () => {
    const [top] = guidance("what do I do when an API returns 429?").items;

    expect(top.slug).toBe("calling-an-api");
    expect(top.excerpt).toContain("429");
    expect(top.excerpt.length).toBeLessThanOrEqual(BODY_MAX_CHARS);
    // The lead-in is kept for orientation, but the matching section is present.
    expect(top.excerpt).toMatch(/^## |Calling an API|You know what an API is|\S/);
    expect(top.excerpt).toMatch(/##/);
  });

  it("keeps every excerpt bounded and free of frontmatter", () => {
    for (const item of guidance("data").items) {
      expect(item.excerpt.length).toBeLessThanOrEqual(2_400);
      expect(item.excerpt).not.toContain("description:");
      expect(item.excerpt).not.toContain("order:");
    }
  });

  it("offers a way in when nothing matches instead of an empty answer", () => {
    const result = guidance("zzzqqq unmatchable gibberish");

    expect(result.items).toEqual([]);
    expect(result.related.length).toBeGreaterThan(1);
    expect(result.related.length).toBeLessThanOrEqual(GUIDANCE_RELATED_MAX);
    expect(new Set(result.related.map((item) => item.category)).size)
      .toBe(result.related.length);
  });

  it("clamps max_items to the supported range", () => {
    expect(guidance("data", { maxItems: 99 }).items.length).toBeLessThanOrEqual(3);
    expect(guidance("data", { maxItems: 1 }).items).toHaveLength(1);
    expect(guidance("data", { maxItems: 0 }).items).toHaveLength(1);
  });

  it("presents public metadata only, with club-scoped canonical URLs", () => {
    const [top] = guidance("hosting an app").items;

    expect(top.url).toMatch(/^https:\/\/vibegarden\.test\/clubs\/wotf\//);
    expect(Object.keys(top).sort()).toEqual([
      "category", "description", "excerpt", "kind", "level", "slug", "title", "url",
    ]);
  });

  it("uses only the supplied content sources", () => {
    const result = presentGuidance({
      appOrigin,
      clubSlug: "wotf",
      question: "how do I host images?",
      getArticles: () => [{
        slug: "only-article",
        title: "Hosting images",
        description: "Where images live",
        category: "Building",
        level: "hands-on" as const,
        order: 1,
      }],
      getModules: () => [],
      getArticleRaw: () => "---\ntitle: hidden\n---\nLead.\n\n## Images\n\nBuckets hold images.",
      getModuleRaw: () => undefined,
    });

    expect(slugs(result)).toEqual(["only-article"]);
    expect(result.items[0].excerpt).toContain("Buckets hold images.");
    expect(result.items[0].excerpt).not.toContain("hidden");
  });
});

describe("MCP library guide", () => {
  it("lists every article and module grouped by category", () => {
    const guide = presentLibraryGuide(library);

    for (const article of getArticles()) {
      expect(guide).toContain(`(\`${article.slug}\``);
      expect(guide).toContain(article.title);
    }
    for (const module of getModules()) {
      expect(guide).toContain(`(\`${module.slug}\``);
    }
    expect(guide).toContain("## Learning articles");
    expect(guide).toContain("## Building blocks");
    expect(guide).toContain("### Foundations");
  });

  it("points hosts at the tools and at club material over recollection", () => {
    const guide = presentLibraryGuide(library);

    expect(guide).toContain("get_guidance");
    expect(guide).toContain("read_article(slug)");
    expect(guide).toContain("read_module(slug)");
    expect(guide).toMatch(/prefer this material over general recollection/i);
    expect(guide).not.toMatch(/[—–]/);
  });

  it("uses club-scoped canonical URLs", () => {
    const guide = presentLibraryGuide({ ...library, clubSlug: "other club" });

    expect(guide).toContain("https://vibegarden.test/clubs/other%20club/learning/");
    expect(guide).toContain("https://vibegarden.test/clubs/other%20club/garden/modules/");
  });
});
