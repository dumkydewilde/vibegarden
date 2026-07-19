import { describe, expect, it } from "vitest";
import { getArticleRaw } from "~/lib/content";
import { getModuleRaw } from "~/lib/modules";
import {
  listLearningContent,
  presentArticle,
  presentModule,
} from "~/lib/mcp/content-presenter";
import { BODY_MAX_CHARS } from "~/lib/mcp/contracts";

const appOrigin = "https://vibegarden.test";

describe("MCP learning content presenters", () => {
  it("presents article and module bodies without frontmatter or components", () => {
    const article = presentArticle(appOrigin, "wotf", {
      slug: "article-1",
      title: "Article",
      description: "Description",
      category: "Foundations",
      level: "starter",
      raw: "---\r\ntitle: private\r\n---\r\nArticle body",
      Component: () => null,
    });
    const module = presentModule(appOrigin, "wotf", {
      slug: "module-1",
      title: "Module",
      description: "Description",
      category: "Inputs",
      raw: "---\ntitle: private\n---\nModule body",
      Component: () => null,
    });

    expect(article).toMatchObject({
      kind: "article",
      url: "https://vibegarden.test/clubs/wotf/learning/article-1",
      body: "Article body",
    });
    expect(module).toMatchObject({
      kind: "module",
      url: "https://vibegarden.test/clubs/wotf/garden/modules/module-1",
      body: "Module body",
    });
    expect(JSON.stringify([article, module])).not.toContain("private");
    expect(article).not.toHaveProperty("Component");
  });

  it("filters public learning metadata and matches body text", () => {
    const result = listLearningContent({
      appOrigin,
      clubSlug: "wotf",
      kind: "article",
      query: "very good guesser",
      pageSize: 50,
      getArticles: () => [{
        slug: "what-is-an-llm",
        title: "What is an LLM?",
        description: "Intro",
        category: "Foundations",
        level: "starter" as const,
        order: 1,
      }],
      getModules: () => [],
      getArticleRaw,
      getModuleRaw,
    });

    expect(result).toEqual({
      items: [expect.objectContaining({
        kind: "article",
        slug: "what-is-an-llm",
        url: "https://vibegarden.test/clubs/wotf/learning/what-is-an-llm",
      })],
    });
  });

  it("caps bodies and encodes content IDs in public URLs", () => {
    const slug = "a slug/with?reserved";
    const article = presentArticle(appOrigin, "club /?", {
      slug,
      title: "Article",
      description: "Description",
      category: "Foundations",
      level: "starter",
      raw: `---\ntitle: hidden\n---\n${"a".repeat(BODY_MAX_CHARS + 1)}`,
    });
    const module = presentModule(appOrigin, "club /?", {
      slug,
      title: "Module",
      description: "Description",
      category: "Inputs",
      raw: `---\ntitle: hidden\n---\n${"b".repeat(BODY_MAX_CHARS + 1)}`,
    });

    expect(article.body).toHaveLength(BODY_MAX_CHARS);
    expect(module.body).toHaveLength(BODY_MAX_CHARS);
    expect(article.url).toBe("https://vibegarden.test/clubs/club%20%2F%3F/learning/a%20slug%2Fwith%3Freserved");
    expect(module.url).toBe("https://vibegarden.test/clubs/club%20%2F%3F/garden/modules/a%20slug%2Fwith%3Freserved");
  });

  it("uses exact content offset page boundaries and only exposes a supplied next cursor", () => {
    const articles = [1, 2, 3].map((order) => ({
      slug: `article-${order}`,
      title: `Article ${order}`,
      description: "Description",
      category: "Foundations",
      level: "starter" as const,
      order,
    }));
    const input = {
      appOrigin,
      clubSlug: "wotf",
      kind: "article" as const,
      pageSize: 2,
      getArticles: () => articles,
      getModules: () => [],
      getArticleRaw: (slug: string) => `# ${slug}`,
      getModuleRaw: () => undefined,
    };

    expect(listLearningContent({ ...input, nextCursor: "offset-2" })).toEqual({
      items: [expect.objectContaining({ slug: "article-1" }), expect.objectContaining({ slug: "article-2" })],
      next_cursor: "offset-2",
    });
    expect(listLearningContent({ ...input, position: { offset: 2 }, nextCursor: "offset-4" })).toEqual({
      items: [expect.objectContaining({ slug: "article-3" })],
    });
    expect(listLearningContent({ ...input, position: { offset: 3 }, nextCursor: "offset-5" })).toEqual({
      items: [],
    });
  });
});
