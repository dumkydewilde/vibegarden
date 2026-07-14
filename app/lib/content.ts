import type { ComponentType } from "react";

export type ArticleMeta = {
  slug: string;
  title: string;
  description: string;
  category: string;
  level: "starter" | "hands-on";
  order: number;
};

export type Article = {
  meta: ArticleMeta;
  Component: ComponentType<{
    components?: Record<string, ComponentType<unknown>>;
  }>;
};

type MdxModule = {
  default: Article["Component"];
  frontmatter?: Record<string, unknown>;
};

// Both globs are eager: the content set is small and ships as one bundle.
// The raw variant feeds The Gardener's context in phase 3.
const modules = import.meta.glob<MdxModule>("/content/learning/*.mdx", {
  eager: true,
});
const rawModules = import.meta.glob<string>("/content/learning/*.mdx", {
  eager: true,
  query: "?raw",
  import: "default",
});

// Curated category order; anything unknown sorts after these, alphabetically.
const categoryOrder = ["Foundations", "Building", "Working with data"];

const slugOf = (path: string) =>
  path.split("/").pop()!.replace(/\.mdx$/, "");

const articles = new Map<string, Article>(
  Object.entries(modules).map(([path, mod]) => {
    const slug = slugOf(path);
    const fm = mod.frontmatter ?? {};
    const meta: ArticleMeta = {
      slug,
      title: String(fm.title ?? slug),
      description: String(fm.description ?? ""),
      category: String(fm.category ?? "Foundations"),
      level: fm.level === "hands-on" ? "hands-on" : "starter",
      order: Number(fm.order ?? 999),
    };
    return [slug, { meta, Component: mod.default }];
  }),
);

function categoryRank(category: string) {
  const i = categoryOrder.indexOf(category);
  return i === -1 ? categoryOrder.length : i;
}

export function getArticles(): ArticleMeta[] {
  return [...articles.values()]
    .map((a) => a.meta)
    .sort(
      (a, b) =>
        categoryRank(a.category) - categoryRank(b.category) ||
        a.category.localeCompare(b.category) ||
        a.order - b.order ||
        a.title.localeCompare(b.title),
    );
}

export function getArticlesByCategory(): {
  category: string;
  articles: ArticleMeta[];
}[] {
  const groups: { category: string; articles: ArticleMeta[] }[] = [];
  for (const meta of getArticles()) {
    const group = groups.find((g) => g.category === meta.category);
    if (group) group.articles.push(meta);
    else groups.push({ category: meta.category, articles: [meta] });
  }
  return groups;
}

export function getArticle(slug: string): Article | undefined {
  return articles.get(slug);
}

export function getArticleRaw(slug: string): string | undefined {
  const entry = Object.entries(rawModules).find(([p]) => slugOf(p) === slug);
  return entry?.[1];
}
