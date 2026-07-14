import { describe, expect, it } from "vitest";
import {
  getArticle,
  getArticleRaw,
  getArticles,
  getArticlesByCategory,
} from "~/lib/content";

describe("content collection", () => {
  it("finds the sample articles with complete metadata", () => {
    const articles = getArticles();
    expect(articles.length).toBeGreaterThanOrEqual(3);
    for (const meta of articles) {
      expect(meta.slug).toBeTruthy();
      expect(meta.title).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.category).toBeTruthy();
    }
  });

  it("sorts Foundations before other categories, and by order within", () => {
    const articles = getArticles();
    expect(articles[0].category).toBe("Foundations");
    const foundations = articles.filter((a) => a.category === "Foundations");
    const orders = foundations.map((a) => a.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("groups by category without duplicates", () => {
    const groups = getArticlesByCategory();
    const names = groups.map((g) => g.category);
    expect(new Set(names).size).toBe(names.length);
    expect(groups.flatMap((g) => g.articles).length).toBe(
      getArticles().length,
    );
  });

  it("resolves a known slug to a renderable component", () => {
    const article = getArticle("what-is-an-llm");
    expect(article).toBeDefined();
    expect(article!.meta.title.toLowerCase()).toContain("llm");
    expect(typeof article!.Component).toBe("function");
  });

  it("returns undefined for unknown slugs", () => {
    expect(getArticle("does-not-exist")).toBeUndefined();
    expect(getArticleRaw("does-not-exist")).toBeUndefined();
  });

  it("exposes raw article text for the agent", () => {
    const raw = getArticleRaw("what-is-an-llm");
    expect(raw).toContain("title:");
    expect(raw!.length).toBeGreaterThan(500);
  });
});
