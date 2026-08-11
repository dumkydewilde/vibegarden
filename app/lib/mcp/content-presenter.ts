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

type ContentGetters = {
  getArticles?: () => ArticleMeta[];
  getModules?: () => ModuleMeta[];
  getArticleRaw?: (slug: string) => string | undefined;
  getModuleRaw?: (slug: string) => string | undefined;
};

export const GUIDANCE_MAX_ITEMS = 3;
export const GUIDANCE_RELATED_MAX = 6;
/** Bounds one guidance excerpt well under the shared per-body cap. */
const EXCERPT_MAX_CHARS = 2_400;
const EXCERPT_LEAD_CHARS = 500;
const EXCERPT_SECTION_CHARS = 900;

type LearningContentInput = ContentGetters & {
  appOrigin: string;
  clubSlug: string;
  query?: string;
  kind?: ContentKind;
  category?: string;
  pageSize?: number;
  position?: ContentPosition;
  /** A signed cursor prepared by the MCP handler for the next page. */
  nextCursor?: string;
};

type GuidanceInput = ContentGetters & {
  appOrigin: string;
  clubSlug: string;
  question: string;
  kind?: ContentKind;
  maxItems?: number;
};

type ArticleInput = ArticleMeta & { raw?: string; Component?: unknown };
type ModuleInput = ModuleMeta & { raw?: string; Component?: unknown };

type ListItem =
  | { kind: "article"; meta: ArticleMeta; raw: string }
  | { kind: "module"; meta: ModuleMeta; raw: string };

function canonicalUrl(appOrigin: string, path: string): string {
  return new URL(path, appOrigin).toString();
}

function clubBase(clubSlug: string) {
  return `/clubs/${encodeURIComponent(clubSlug)}`;
}

function body(raw: string): string {
  return stripFrontmatter(raw).slice(0, BODY_MAX_CHARS);
}

/**
 * Collects every build-time article and module in one stable order: articles
 * before modules, then frontmatter order, then title and slug. Every content
 * surface here reads from this one list so listing, guidance, and the library
 * overview can never disagree about what exists.
 */
function libraryItems(getters: ContentGetters): ListItem[] {
  const getArticles = getters.getArticles ?? defaultGetArticles;
  const getModules = getters.getModules ?? defaultGetModules;
  const getArticleRaw = getters.getArticleRaw ?? defaultGetArticleRaw;
  const getModuleRaw = getters.getModuleRaw ?? defaultGetModuleRaw;

  return [
    ...getArticles().flatMap((meta) => {
      const raw = getArticleRaw(meta.slug);
      return raw === undefined ? [] : [{ kind: "article" as const, meta, raw }];
    }),
    ...getModules().flatMap((meta) => {
      const raw = getModuleRaw(meta.slug);
      return raw === undefined ? [] : [{ kind: "module" as const, meta, raw }];
    }),
  ].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.meta.order - b.meta.order ||
      a.meta.title.localeCompare(b.meta.title) ||
      a.meta.slug.localeCompare(b.meta.slug),
  );
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

function presentListItem(appOrigin: string, clubSlug: string, item: ListItem) {
  if (item.kind === "article") {
    return {
      kind: "article" as const,
      slug: item.meta.slug,
      title: item.meta.title,
      description: item.meta.description,
      category: item.meta.category,
      level: item.meta.level,
      url: canonicalUrl(
        appOrigin,
        `${clubBase(clubSlug)}/learning/${encodeURIComponent(item.meta.slug)}`,
      ),
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
      `${clubBase(clubSlug)}/garden/modules/${encodeURIComponent(item.meta.slug)}`,
    ),
  };
}

/**
 * Lists build-time learning content after the MCP handler has decoded its
 * opaque cursor. The handler signs `nextCursor` only when a next position
 * exists; this pure presenter never sees a cursor secret.
 */
export function listLearningContent(input: LearningContentInput) {
  const query = input.query?.trim().toLowerCase();
  const pageSize = clampPageSize(input.pageSize, "list");
  const offset = input.position?.offset ?? 0;

  const items = libraryItems(input)
    .filter((item) => !input.kind || item.kind === input.kind)
    .filter((item) => !input.category || item.meta.category === input.category)
    .filter((item) => !query || matchesQuery(item, query));

  const page = items.slice(offset, offset + pageSize);
  const result = {
    items: page.map((item) => presentListItem(input.appOrigin, input.clubSlug, item)),
  };
  return offset + page.length < items.length && input.nextCursor
    ? { ...result, next_cursor: input.nextCursor }
    : result;
}

/**
 * Words that carry no signal in a how-to question. Anything shorter than
 * three characters is dropped separately, so this list only needs the longer
 * ones.
 */
const QUESTION_STOPWORDS = new Set([
  "about", "all", "and", "any", "are", "been", "best", "but", "can", "could",
  "did", "does", "doing", "for", "from", "get", "getting", "had", "has", "have",
  "here", "how", "into", "its", "just", "like", "made", "make", "making", "many",
  "much", "must", "need", "needs", "not", "now", "one", "our", "out", "over",
  "own", "put", "same", "should", "some", "such", "than", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "those", "too", "use",
  "used", "using", "very", "want", "wants", "was", "way", "were", "what", "when",
  "where", "which", "while", "who", "why", "will", "with", "without", "would",
  "you", "your", "yours",
]);

/**
 * Trims the endings that make a question miss its own answer: a question about
 * "images" should find an article about an "image", and "hosting" should find
 * "host". Crude on purpose, and only ever used as a substring needle.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Turns a question into the deduplicated stems worth searching for. */
function questionNeedles(question: string): string[] {
  const words = normalize(question)
    .split(" ")
    .filter((word) => word.length >= 3 && !QUESTION_STOPWORDS.has(word))
    .map(stem);
  return [...new Set(words)];
}

/**
 * Counts hits with a damped return, so a section that says "API" eight times
 * does not outrank the one section that answers the actual question. Counting
 * stops early: beyond a handful, more repetition tells us nothing.
 */
function proseHits(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count < 6) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count === 0 ? 0 : 1 + Math.log(count);
}

/**
 * Weighs each needle by how rare it is across the texts being searched. Without
 * this, a question like "what do I do when an API returns 429?" is dominated by
 * "api", which is everywhere, and the one passage about 429 loses.
 */
function needleWeights(needles: string[], texts: string[]): Map<string, number> {
  return new Map(needles.map((needle) => {
    const frequency = texts.filter((text) => text.includes(needle)).length;
    return [needle, Math.log(1 + texts.length / (1 + frequency))];
  }));
}

type ItemText = {
  title: string;
  slug: string;
  description: string;
  category: string;
  prose: string;
  haystack: string;
};

function itemText(item: ListItem): ItemText {
  const title = normalize(item.meta.title);
  const slug = normalize(item.meta.slug);
  const description = normalize(item.meta.description);
  const category = normalize(item.meta.category);
  const prose = normalize(stripFrontmatter(item.raw));
  return {
    title,
    slug,
    description,
    category,
    prose,
    haystack: [title, slug, description, category, prose].join(" "),
  };
}

/**
 * Scores one library item against a question. Metadata outweighs prose, so an
 * article named for the topic wins over one that mentions it in passing, and a
 * question repeated verbatim in a title wins outright.
 */
function scoreItem(
  text: ItemText,
  weights: Map<string, number>,
  phrase: string,
): number {
  let score = 0;
  for (const [needle, weight] of weights) {
    score += weight * (
      (text.title.includes(needle) ? 8 : 0)
      + (text.slug.includes(needle) ? 5 : 0)
      + (text.description.includes(needle) ? 4 : 0)
      + (text.category.includes(needle) ? 3 : 0)
      + proseHits(text.prose, needle)
    );
  }

  if (phrase.length >= 8) {
    if (text.title.includes(phrase)) score += 12;
    else if (text.prose.includes(phrase)) score += 6;
  }
  return score;
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  const window = trimmed.slice(0, limit);
  const boundary = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
  const cut = boundary > limit * 0.4 ? window.slice(0, boundary + 1) : window;
  return `${cut.trim()}…`;
}

type Section = { heading?: string; body: string };

/** Splits MDX prose into its lead-in and its `##` sections, headings kept. */
function sections(raw: string): Section[] {
  const text = stripFrontmatter(raw).trim();
  const result: Section[] = [];
  const pattern = /^## +(.+)$/gm;
  let cursor = 0;
  let heading: string | undefined;
  let match = pattern.exec(text);
  while (match) {
    const chunk = text.slice(cursor, match.index).trim();
    if (chunk) result.push({ ...(heading ? { heading } : {}), body: chunk });
    heading = match[1].trim();
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }
  const tail = text.slice(cursor).trim();
  if (tail) result.push({ ...(heading ? { heading } : {}), body: tail });
  return result;
}

/**
 * Builds the excerpt a host can answer from: the lead-in for orientation plus
 * the sections that actually match the question, in document order. Falls back
 * to the opening of the piece when nothing matches a heading or its prose.
 */
function excerptFor(raw: string, needles: string[]): string {
  const all = sections(raw);
  if (!all.length) return "";
  const lead = all[0].heading === undefined ? all[0] : undefined;
  const candidates = all.filter((section) => section.heading !== undefined);
  const texts = candidates.map((section) => (
    `${normalize(section.heading ?? "")} ${normalize(section.body)}`
  ));
  const weights = needleWeights(needles, texts);

  const scored = candidates
    .map((section, index) => {
      const heading = normalize(section.heading ?? "");
      const prose = normalize(section.body);
      let score = 0;
      for (const [needle, weight] of weights) {
        score += weight * (
          (heading.includes(needle) ? 4 : 0) + proseHits(prose, needle)
        );
      }
      return { section, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index);

  const chosen = scored.length
    ? scored.map((entry) => entry.section)
    : candidates.slice(0, 1);

  const parts = [
    ...(lead ? [clip(lead.body, EXCERPT_LEAD_CHARS)] : []),
    ...chosen.map((section) => (
      `## ${section.heading}\n\n${clip(section.body, EXCERPT_SECTION_CHARS)}`
    )),
  ];
  return clip(parts.join("\n\n"), EXCERPT_MAX_CHARS);
}

/**
 * Answers a build-question with Vibe Garden's own material in one call: the
 * best-matching articles and modules with targeted excerpts, plus the near
 * misses to drill into. When nothing matches, `related` still offers a way in
 * so the host never has to guess what exists.
 */
export function presentGuidance(input: GuidanceInput) {
  const needles = questionNeedles(input.question);
  const phrase = normalize(input.question);
  const maxItems = Math.min(
    Math.max(Math.trunc(input.maxItems ?? GUIDANCE_MAX_ITEMS), 1),
    GUIDANCE_MAX_ITEMS,
  );
  const pool = libraryItems(input)
    .filter((item) => !input.kind || item.kind === input.kind);
  const texts = pool.map(itemText);
  const weights = needleWeights(needles, texts.map((text) => text.haystack));

  const ranked = pool
    .map((item, index) => ({
      item,
      index,
      score: scoreItem(texts[index], weights, phrase),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const matched = ranked.slice(0, maxItems);
  const related = ranked.length
    ? ranked.slice(maxItems, maxItems + GUIDANCE_RELATED_MAX)
    : firstPerCategory(pool).slice(0, GUIDANCE_RELATED_MAX).map((item, index) => ({
        item,
        index,
        score: 0,
      }));

  return {
    items: matched.map((entry) => ({
      ...presentListItem(input.appOrigin, input.clubSlug, entry.item),
      excerpt: excerptFor(entry.item.raw, needles),
    })),
    related: related.map((entry) => presentListItem(
      input.appOrigin,
      input.clubSlug,
      entry.item,
    )),
  };
}

/** One representative per category, for the "nothing matched" way in. */
function firstPerCategory(pool: ListItem[]): ListItem[] {
  const seen = new Set<string>();
  return pool.filter((item) => {
    const key = `${item.kind}:${item.meta.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Renders the whole library as one markdown overview, grouped by category, for
 * hosts that surface MCP resources. Cheaper than paging a tool and complete,
 * so an assistant can see everything Vibe Garden knows before it answers from
 * its own memory.
 */
export function presentLibraryGuide(input: ContentGetters & {
  appOrigin: string;
  clubSlug: string;
}): string {
  const items = libraryItems(input);
  const groups = (kind: ContentKind) => {
    const result: { category: string; items: ListItem[] }[] = [];
    for (const item of items.filter((candidate) => candidate.kind === kind)) {
      const group = result.find((entry) => entry.category === item.meta.category);
      if (group) group.items.push(item);
      else result.push({ category: item.meta.category, items: [item] });
    }
    return result;
  };

  const line = (item: ListItem) => {
    const presented = presentListItem(input.appOrigin, input.clubSlug, item);
    const level = "level" in presented && presented.level ? `, ${presented.level}` : "";
    return `- [${item.meta.title}](${presented.url}) (\`${item.meta.slug}\`${level}): ${item.meta.description}`;
  };

  const section = (kind: ContentKind, heading: string, blurb: string) => [
    `## ${heading}`,
    blurb,
    ...groups(kind).flatMap((group) => [
      `### ${group.category}`,
      group.items.map(line).join("\n"),
    ]),
  ].join("\n\n");

  return [
    "# The Vibe Garden library",
    "Everything below ships with Vibe Garden. Ask `get_guidance` with the person's actual question to get the relevant pieces with excerpts, or read one whole with `read_article(slug)` or `read_module(slug)`. Prefer this material over general recollection: it is written for this club, and it names the specific services and costs the group settled on.",
    section(
      "article",
      "Learning articles",
      "Concepts and hands-on walkthroughs. Levels are `starter` and `hands-on`.",
    ),
    section(
      "module",
      "Building blocks",
      "Practical ingredients a project is assembled from. A project stores the blocks it uses by title.",
    ),
  ].join("\n\n");
}

/** Maps one article's metadata and MDX prose to the public MCP read shape. */
export function presentArticle(
  appOrigin: string,
  clubSlug: string,
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
    url: canonicalUrl(
      appOrigin,
      `${clubBase(clubSlug)}/learning/${encodeURIComponent(article.slug)}`,
    ),
    body: body(raw),
  };
}

/** Maps one module's metadata and MDX prose to the public MCP read shape. */
export function presentModule(
  appOrigin: string,
  clubSlug: string,
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
      `${clubBase(clubSlug)}/garden/modules/${encodeURIComponent(module.slug)}`,
    ),
    body: body(raw),
  };
}
