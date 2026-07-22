import type { ToolSpec } from "@vibegarden/agent-core";
import { getArticle, getArticleRaw, getArticles } from "./content";
import { stripFrontmatter } from "./markdown";
import { getModule, getModuleRaw, getModules } from "./modules";
import {
  formatFreshReads,
  FRESH_READ_TYPES,
  queryFreshReads,
  type MotherDuckConfig,
} from "./motherduck.server";
import {
  parseAttachRequest,
  parseQueryRequest,
  QUERY_SQL_MAX_CHARS,
  RESULT_MAX_ROWS,
} from "@vibegarden/agent-web";
import mermaidFlowchartNotes from "../../content/gardener/mermaid-flowchart-notes.md?raw";

/**
 * The Gardener's tools as agent-core ToolSpecs. gardenerToolSpecs(config) is
 * the full set (for executing whatever a model asks for); offered tools
 * per conversation come from offeredGardenerTools, which gates fresh_reads
 * on the MotherDuck token. query_data is always offered to tool-capable
 * models because DuckDB can also build explicit mock/example data in memory.
 */

export const TOOL_RESULT_MAX_CHARS = 20_000;
export const DIAGRAM_TITLE_MAX_CHARS = 120;
export const DIAGRAM_SOURCE_MAX_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 10_000;

/** Very small HTML-to-text: good enough for grounding, not for rendering. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

async function fetchPage(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Error: "${url}" is not a valid URL.`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Error: only http(s) URLs can be fetched.";
  }
  try {
    const res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "VibeGarden-Gardener/1.0" },
      redirect: "follow",
    });
    if (!res.ok) {
      return `Error: the page responded with status ${res.status}.`;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const text = contentType.includes("html") ? htmlToText(body) : body;
    if (!text) return "The page returned no readable text.";
    return text.length > TOOL_RESULT_MAX_CHARS
      ? `${text.slice(0, TOOL_RESULT_MAX_CHARS)}\n\n[truncated]`
      : text;
  } catch {
    return "Error: the page could not be fetched (timeout or network error).";
  }
}

type ValidFlow = { title: string; diagram: string };
type FlowValidation =
  | { value: ValidFlow; error?: never }
  | { value?: never; error: string };

function validateFlow(args: Record<string, unknown>): FlowValidation {
  if (typeof args.title !== "string" || !args.title.trim()) {
    return { error: "Error: diagram title is required." };
  }
  if (typeof args.diagram !== "string" || !args.diagram.trim()) {
    return { error: "Error: Mermaid diagram source is required." };
  }
  const title = args.title.trim();
  const diagram = args.diagram.trim();
  // Charting data belongs to query_data, whose result already renders a
  // clean chart. Reject Mermaid attempts to plot data (xychart, plus the
  // invalid line/bar/pie "chart" types the model reaches for, which do not
  // render at all) so it does not draw a second, broken copy of the numbers.
  if (/\b(xychart(-beta)?|line-?chart|bar-?chart|pie-?chart)\b/i.test(diagram)) {
    return {
      error:
        "Error: do not chart data with Mermaid. Use the chart option of query_data instead; visualize_flow is only for flows, sequences, decision paths, and relationships.",
    };
  }
  if (title.length > DIAGRAM_TITLE_MAX_CHARS) {
    return { error: "Error: diagram title must be 120 characters or fewer." };
  }
  if (diagram.length > DIAGRAM_SOURCE_MAX_CHARS) {
    return {
      error: "Error: Mermaid diagram source must be 12,000 characters or fewer.",
    };
  }
  return { value: { title, diagram } };
}

const readArticleSpec: ToolSpec = {
  name: "read_article",
  description:
    "Read the full text of a learning article from this site. Use it before answering in depth about a topic an article covers, or when the person asks about an article.",
  promptGuidance:
    "read_article(slug): the full text of a learning article. Use it before answering in depth about something an article covers.",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: 'Article slug, e.g. "what-is-an-llm".',
      },
    },
    required: ["slug"],
  },
  execute: (args) => {
    const slug = String(args.slug ?? "");
    const raw = getArticleRaw(slug);
    if (!raw) {
      const known = getArticles()
        .map((a) => a.slug)
        .join(", ");
      return `Error: no article with slug "${slug}". Available slugs: ${known}.`;
    }
    return stripFrontmatter(raw).slice(0, TOOL_RESULT_MAX_CHARS);
  },
  noteFor: (args) => {
    const slug = String(args.slug ?? "");
    return getArticle(slug)
      ? { type: "note", kind: "article", value: slug }
      : { type: "note", kind: "note", value: "looking for an article" };
  },
};

type ArticleRecommendations = { slugs: string[] };
type ArticleRecommendationValidation =
  | { value: ArticleRecommendations; error?: never }
  | { value?: never; error: string };

function validateArticleRecommendations(
  args: Record<string, unknown>,
): ArticleRecommendationValidation {
  if (!Array.isArray(args.slugs) || args.slugs.length < 1 || args.slugs.length > 3) {
    return { error: "Error: choose between one and three learning article slugs." };
  }
  if (!args.slugs.every((slug) => typeof slug === "string")) {
    return { error: "Error: every learning article slug must be a string." };
  }
  const slugs = [...new Set(args.slugs.map((slug) => slug.trim()).filter(Boolean))];
  const unknown = slugs.filter((slug) => !getArticle(slug));
  if (slugs.length === 0 || unknown.length > 0) {
    const known = getArticles()
      .map((article) => article.slug)
      .join(", ");
    return {
      error: `Error: unknown learning article slug${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ") || "empty"}. Available slugs: ${known}.`,
    };
  }
  return { value: { slugs } };
}

const recommendArticlesSpec: ToolSpec = {
  name: "recommend_articles",
  description:
    "Display one to three known Vibe Garden learning articles as clickable cards. Use this for generic requests for articles, reading recommendations, or something to learn; do not replace them with unrelated web links.",
  promptGuidance:
    "recommend_articles(slugs): display one to three known learning articles as clickable cards. Use it for generic article, reading, or learning recommendations. The cards contain the links already, so explain briefly why they fit without repeating the links in prose.",
  parameters: {
    type: "object",
    properties: {
      slugs: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: { type: "string" },
        description: "One to three slugs from the learning article index.",
      },
    },
    required: ["slugs"],
  },
  execute: (args) => {
    const recommendations = validateArticleRecommendations(args);
    if (recommendations.error) return recommendations.error;
    const lines = recommendations.value.slugs.map((slug) => {
      const article = getArticle(slug)!;
      return `- [${article.meta.title}](/learning/${slug}): ${article.meta.description}`;
    });
    return `These learning article cards are displayed in the chat:\n${lines.join("\n")}\nBriefly explain why they fit. Do not repeat their links.`;
  },
  noteFor: (args) => {
    const recommendations = validateArticleRecommendations(args);
    return recommendations.error
      ? null
      : { type: "articles", slugs: recommendations.value.slugs };
  },
};

const readModuleSpec: ToolSpec = {
  name: "read_module",
  description:
    "Read the know-how notes for one of the site's building blocks (what it is, when to use it, setup steps, options and costs). Use it when a project idea involves that block.",
  promptGuidance:
    "read_module(slug): know-how on one building block: what it is, setup steps, options and costs. Slugs: " +
    getModules()
      .map((module) => `${module.slug} (${module.title})`)
      .join(", ") +
    ".",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: 'Building block slug, e.g. "google-sheet".',
      },
    },
    required: ["slug"],
  },
  execute: (args) => {
    const slug = String(args.slug ?? "");
    const raw = getModuleRaw(slug);
    if (!raw) {
      const known = getModules()
        .map((m) => m.slug)
        .join(", ");
      return `Error: no building block with slug "${slug}". Available slugs: ${known}.`;
    }
    return stripFrontmatter(raw).slice(0, TOOL_RESULT_MAX_CHARS);
  },
  noteFor: (args) => {
    const slug = String(args.slug ?? "");
    return getModule(slug)
      ? { type: "note", kind: "module", value: slug }
      : { type: "note", kind: "note", value: "looking for a building block" };
  },
};

const fetchPageSpec: ToolSpec = {
  name: "fetch_page",
  description:
    "Fetch a public web page and return its text content. Use it when the person shares a URL or when a specific page would ground the answer. Not a search engine: it needs a full URL.",
  promptGuidance:
    "fetch_page(url): the text of a public web page. Use it when the person shares a link.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full http(s) URL of the page to fetch.",
      },
    },
    required: ["url"],
  },
  execute: (args) => fetchPage(String(args.url ?? "")),
  noteFor: (args) => {
    try {
      return {
        type: "note",
        kind: "web",
        value: new URL(String(args.url ?? "")).hostname,
      };
    } catch {
      return { type: "note", kind: "note", value: "fetching a page" };
    }
  },
};

const visualizeFlowSpec: ToolSpec = {
  name: "visualize_flow",
  description:
    "Render a Mermaid diagram directly in the chat. Use it when a flow, sequence, decision path, or relationship is materially clearer as a visual. Keep the diagram small, readable, and useful to someone who may not program.",
  promptGuidance:
    "visualize_flow(title, diagram): render a Mermaid flow, sequence, decision path, or relationship directly in the chat. Use it only when the visual is clearer than prose, keep it small, and follow it with a short explanation. Never use it to chart data: numeric results get the chart option of query_data instead.\n\n" +
    mermaidFlowchartNotes.trim(),
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "A short human-readable title for the diagram.",
      },
      diagram: {
        type: "string",
        description: "Valid Mermaid source, including its diagram type.",
      },
    },
    required: ["title", "diagram"],
  },
  execute: (args) => {
    const flow = validateFlow(args);
    return flow.error
      ? flow.error
      : `Diagram "${flow.value.title}" is ready. Briefly explain what it shows.`;
  },
  noteFor: (args) => {
    const flow = validateFlow(args);
    return flow.error
      ? null
      : { type: "diagram", title: flow.value.title, diagram: flow.value.diagram };
  },
};

const freshReadsSpec = (config: MotherDuckConfig = {}): ToolSpec => ({
  name: "fresh_reads",
  description:
    "Recent worthwhile reads from Dumky's curated RSS feed: news, opinion pieces, and tutorials about AI and building things, scored for interestingness. Use it to point at something current, or when the person asks what is happening in AI right now.",
  promptGuidance:
    "fresh_reads(topic?, content_type?): recent well-scored news, opinion pieces, and tutorials about AI and building things, from a curated reading feed. Use it when something current would enrich the answer, and share the best one or two as markdown links.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description:
          "Optional free-text filter matched against title, summary, and key insight.",
      },
      content_type: {
        type: "string",
        enum: [...FRESH_READ_TYPES],
        description: "Optional: limit to one kind. Omit for all three.",
      },
    },
  },
  execute: async (args) => {
    try {
      const reads = await queryFreshReads(config, {
        topic: args.topic ? String(args.topic) : undefined,
        contentType: args.content_type ? String(args.content_type) : undefined,
      });
      return formatFreshReads(reads);
    } catch (e) {
      console.error("fresh_reads failed", e);
      return "Error: the reading feed is not reachable right now.";
    }
  },
  noteFor: (args) => {
    const topic = args.topic ? String(args.topic).slice(0, 60) : "";
    return {
      type: "note",
      kind: "note",
      value: topic
        ? `looking for fresh reads about ${topic}`
        : "looking for fresh reads",
    };
  },
});

const queryDataSpec: ToolSpec = {
  name: "query_data",
  description:
    "Run DuckDB SQL in the person's browser. It can query attached datasets or create explicit mock/example data with VALUES, range, or generate_series; it never runs on a server. The capped result (max 50 rows) arrives in a follow-up message, after which you narrate the key numbers. Optionally pass a chart to draw a small visual next to the result table.",
  promptGuidance: `query_data(sql, chart?): run DuckDB SQL in the person's browser and show its result as a table. With attached datasets (listed below), aggregate to a few rows (GROUP BY, LIMIT) rather than selecting everything. Without a dataset, use VALUES, range, or generate_series only when the person explicitly asks for mock or example data; never invent data for a factual question. Pass chart {type: line|scatter|bar, x, y, title} when a trend or comparison is clearer as a visual, and always when the person asks for a chart; x and y must be columns of the query result. This is the only way to chart data (never Mermaid). Results are capped at ${RESULT_MAX_ROWS} rows. Column types come from how a CSV was sniffed, so a date stored as text (e.g. "21-JUN-07") stays VARCHAR: parse it with strptime(col, '%d-%b-%y'), not CAST AS DATE. After the result arrives, state the key numbers plainly and briefly; never invent values you have not seen. If the result reports an error, change the SQL and try again.`,
  parameters: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: `DuckDB SQL over the attached tables, ${QUERY_SQL_MAX_CHARS} characters max.`,
      },
      chart: {
        type: "object",
        description:
          "Optional small chart of the result: pick two result columns.",
        properties: {
          type: { type: "string", enum: ["line", "scatter", "bar"] },
          x: { type: "string", description: "Result column for the x axis." },
          y: {
            type: "string",
            description: "Numeric result column for the y axis.",
          },
          title: { type: "string", description: "Short chart title." },
        },
        required: ["type", "x", "y"],
      },
    },
    required: ["sql"],
  },
  // A valid call is fulfilled by the browser (DuckDB-WASM), so it delegates
  // and ends the turn; only invalid calls reach execute, whose error goes
  // back to the model for repair.
  delegate: (args) => parseQueryRequest(args).value ?? null,
  execute: (args) =>
    parseQueryRequest(args).error ?? "Error: query_data ran out of band.",
};

const attachDataSpec: ToolSpec = {
  name: "attach_data",
  description:
    "Attach a public data link as a queryable dataset: a CSV, JSON, Parquet, or Excel file, or an API URL returning one of those. The person's browser fetches it (never a server) and registers it as a DuckDB table; the schema arrives in a follow-up message, after which query_data can read it.",
  promptGuidance:
    "attach_data(url): fetch a public data link in the person's browser and register it as a queryable DuckDB table. The schema comes back in a follow-up message and query_data becomes available. If the browser cannot load it, ask the person to download the file and attach it with the tools button instead.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full http(s) URL of the data file or API endpoint.",
      },
    },
    required: ["url"],
  },
  delegate: (args) => parseAttachRequest(args).value ?? null,
  execute: (args) =>
    parseAttachRequest(args).error ?? "Error: attach_data ran out of band.",
};

export type GardenerToolsConfig = {
  freshReads?: MotherDuckConfig;
};

/** Every Gardener tool, for executing whatever calls a model produces. */
export function gardenerToolSpecs(config: GardenerToolsConfig = {}): ToolSpec[] {
  return [
    readArticleSpec,
    recommendArticlesSpec,
    readModuleSpec,
    fetchPageSpec,
    visualizeFlowSpec,
    attachDataSpec,
    freshReadsSpec(config.freshReads),
    queryDataSpec,
  ];
}

/**
 * The tools offered to the model for one conversation: fresh_reads only
 * when a MotherDuck token is configured. Browser DuckDB is useful both for
 * attached datasets and for explicit standalone mock/example charts.
 */
export function offeredGardenerTools(
  config: GardenerToolsConfig = {},
): ToolSpec[] {
  return gardenerToolSpecs(config).filter((spec) => {
    if (spec.name === "fresh_reads") return !!config.freshReads?.token;
    return true;
  });
}
