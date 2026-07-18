import { describe, expect, it } from "vitest";
import { getArticleRaw } from "~/lib/content";
import { getModuleRaw } from "~/lib/modules";
import {
  listLearningContent,
  presentArticle,
  presentModule,
} from "~/lib/mcp/content-presenter";

const appOrigin = "https://vibegarden.test";

describe("MCP learning content presenters", () => {
  it("presents article and module bodies without frontmatter or components", () => {
    const article = presentArticle(appOrigin, {
      slug: "article-1",
      title: "Article",
      description: "Description",
      category: "Foundations",
      level: "starter",
      raw: "---\r\ntitle: private\r\n---\r\nArticle body",
      Component: () => null,
    });
    const module = presentModule(appOrigin, {
      slug: "module-1",
      title: "Module",
      description: "Description",
      category: "Inputs",
      raw: "---\ntitle: private\n---\nModule body",
      Component: () => null,
    });

    expect(article).toMatchObject({
      kind: "article",
      url: "https://vibegarden.test/learning/article-1",
      body: "Article body",
    });
    expect(module).toMatchObject({
      kind: "module",
      url: "https://vibegarden.test/garden/modules/module-1",
      body: "Module body",
    });
    expect(JSON.stringify([article, module])).not.toContain("private");
    expect(article).not.toHaveProperty("Component");
  });

  it("filters public learning metadata and matches body text", () => {
    const result = listLearningContent({
      appOrigin,
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
        url: "https://vibegarden.test/learning/what-is-an-llm",
      })],
    });
  });
});
