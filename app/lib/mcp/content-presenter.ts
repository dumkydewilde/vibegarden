import {
  getArticleRaw as defaultGetArticleRaw,
  getArticles as defaultGetArticles,
  type ArticleMeta,
} from "~/lib/content";
import { BODY_MAX_CHARS, clampPageSize } from "~/lib/mcp/contracts";
import { stripFrontmatter } from "~/lib/markdown";
import {
  getModuleRaw as defaultGetModuleRaw,
  getModules as defaultGetModules,
  type ModuleMeta,
} from "~/lib/modules";

type ContentKind = "article" | "module";
type ContentPosition = { offset: number };

type LearningContentInput = {
  appOrigin: string;
  query?: string;
  kind?: ContentKind;
  category?: string;
  pageSize?: number;
  position?: ContentPosition;
  /** A signed cursor prepared by the MCP handler for the next page. */
  nextCursor?: string;
  getArticles?: () => ArticleMeta[];
  getModules?: () => ModuleMeta[];
  getArticleRaw?: (slug: string) => string | undefined;
  getModuleRaw?: (slug: string) => string | undefined;
};

type ArticleInput = ArticleMeta & { raw?: string; Component?: unknown };
type ModuleInput = ModuleMeta & { raw?: string; Component?: unknown };

type ListItem =
  | { kind: "article"; meta: ArticleMeta; raw: string }
  | { kind: "module"; meta: ModuleMeta; raw: string };

function canonicalUrl(appOrigin: string, path: string): string {
  return new URL(path, appOrigin).toString();
}

function body(raw: string): string {
  return stripFrontmatter(raw).slice(0, BODY_MAX_CHARS);
}

function matchesQuery(item: ListItem, query: string): boolean {
  const haystack = [
    item.meta.title,
    item.meta.description,
    item.meta.category,
    stripFrontmatter(item.raw),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

function presentListItem(appOrigin: string, item: ListItem) {
  if (item.kind === "article") {
    return {
      kind: "article" as const,
      slug: item.meta.slug,
      title: item.meta.title,
      description: item.meta.description,
      category: item.meta.category,
      level: item.meta.level,
      url: canonicalUrl(appOrigin, `/learning/${encodeURIComponent(item.meta.slug)}`),
    };
  }
  return {
    kind: "module" as const,
    slug: item.meta.slug,
    title: item.meta.title,
    description: item.meta.description,
    category: item.meta.category,
    url: canonicalUrl(
      appOrigin,
      `/garden/modules/${encodeURIComponent(item.meta.slug)}`,
    ),
  };
}

/**
 * Lists build-time learning content after the MCP handler has decoded its
 * opaque cursor. The handler signs `nextCursor` only when a next position
 * exists; this pure presenter never sees a cursor secret.
 */
export function listLearningContent(input: LearningContentInput) {
  const getArticles = input.getArticles ?? defaultGetArticles;
  const getModules = input.getModules ?? defaultGetModules;
  const getArticleRaw = input.getArticleRaw ?? defaultGetArticleRaw;
  const getModuleRaw = input.getModuleRaw ?? defaultGetModuleRaw;
  const query = input.query?.trim().toLowerCase();
  const pageSize = clampPageSize(input.pageSize, "list");
  const offset = input.position?.offset ?? 0;

  const items: ListItem[] = [
    ...getArticles().flatMap((meta) => {
      const raw = getArticleRaw(meta.slug);
      return raw === undefined ? [] : [{ kind: "article" as const, meta, raw }];
    }),
    ...getModules().flatMap((meta) => {
      const raw = getModuleRaw(meta.slug);
      return raw === undefined ? [] : [{ kind: "module" as const, meta, raw }];
    }),
  ]
    .filter((item) => !input.kind || item.kind === input.kind)
    .filter((item) => !input.category || item.meta.category === input.category)
    .filter((item) => !query || matchesQuery(item, query))
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.meta.order - b.meta.order ||
        a.meta.title.localeCompare(b.meta.title) ||
        a.meta.slug.localeCompare(b.meta.slug),
    );

  const page = items.slice(offset, offset + pageSize);
  const result = { items: page.map((item) => presentListItem(input.appOrigin, item)) };
  return offset + page.length < items.length && input.nextCursor
    ? { ...result, next_cursor: input.nextCursor }
    : result;
}

/** Maps one article's metadata and MDX prose to the public MCP read shape. */
export function presentArticle(
  appOrigin: string,
  article: ArticleInput,
  raw = article.raw ?? defaultGetArticleRaw(article.slug) ?? "",
) {
  return {
    kind: "article" as const,
    slug: article.slug,
    title: article.title,
    description: article.description,
    category: article.category,
    level: article.level,
    url: canonicalUrl(appOrigin, `/learning/${encodeURIComponent(article.slug)}`),
    body: body(raw),
  };
}

/** Maps one module's metadata and MDX prose to the public MCP read shape. */
export function presentModule(
  appOrigin: string,
  module: ModuleInput,
  raw = module.raw ?? defaultGetModuleRaw(module.slug) ?? "",
) {
  return {
    kind: "module" as const,
    slug: module.slug,
    title: module.title,
    description: module.description,
    category: module.category,
    url: canonicalUrl(
      appOrigin,
      `/garden/modules/${encodeURIComponent(module.slug)}`,
    ),
    body: body(raw),
  };
}
