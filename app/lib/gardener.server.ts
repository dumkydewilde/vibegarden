import { getArticle, getArticles } from "./content";
import { datasets as datasetCatalog } from "./inspiration-datasets";
import { getModule, getModules, modules } from "./modules";
import {
  DATASET_SUMMARY_MAX_CHARS,
  MAX_DATASETS,
  parseAttachEnvelope,
  RESULT_MAX_ROWS,
} from "./query-tool";
import { toModelText } from "./tool-notes";
import type { ToolCall } from "./gardener-tools.server";
import promptTemplate from "../../content/gardener/system-prompt.md?raw";

// Glob instead of a direct import so deleting the file also disables it.
const audienceFiles = import.meta.glob<string>(
  "/content/gardener/audience.md",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);

/**
 * The optional audience section: who the friends are and how to (subtly)
 * play to their interests. Toggle with `enabled: false` in the file's
 * frontmatter, or delete the file.
 */
export function buildAudienceSection(): string {
  const raw = audienceFiles["/content/gardener/audience.md"];
  if (!raw) return "";
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm && /^enabled:\s*false\s*$/m.test(fm[1])) return "";
  return (fm ? raw.slice(fm[0].length) : raw).trim();
}

/**
 * `data` messages carry a query-result envelope from the browser back to
 * the model during a continuation turn; they are never shown to the person.
 */
export type WireMessage = {
  role: "user" | "assistant" | "data";
  content: string;
};

/** A dataset the person attached, as the client reports it each request. */
export type WireDataset = { name: string; summary: string };
export type WireContextItem = {
  kind: "page" | "article" | "module" | "paragraph" | "project" | "dataset";
  label: string;
  content: string;
};

export const HISTORY_LIMIT = 30;
export const CONTEXT_ITEM_MAX_CHARS = 12_000;
export const MESSAGE_MAX_CHARS = 8_000;

const pageNames: Record<string, string> = {
  "/": "the home page",
  "/garden": "the Idea Garden",
  "/learning": "the learning index",
  "/artifacts": "their artifacts",
  "/gallery": "the gallery",
  "/inspiration": "the inspiration page",
};

function describePage(page: string | undefined) {
  if (!page) return null;
  const articleMatch = page.match(/^\/learning\/([\w-]+)$/);
  if (articleMatch) {
    const article = getArticle(articleMatch[1]);
    if (article) {
      return `the article "${article.meta.title}" (${page}). Do not suggest reading this article, they are already reading it.`;
    }
  }
  const moduleMatch = page.match(/^\/garden\/modules\/([\w-]+)$/);
  if (moduleMatch) {
    const module = getModule(moduleMatch[1]);
    if (module) {
      return `the "${module.meta.title}" building block page (${page}).`;
    }
  }
  const name = pageNames[page];
  return name ? `${name} (${page}).` : `${page}.`;
}

function buildToolsRule(
  toolsEnabled: boolean,
  freshReads: boolean,
  hasDatasets: boolean,
) {
  if (!toolsEnabled) {
    return "You cannot read files or fetch pages in this conversation (the selected model does not support tools). Point at links instead.";
  }
  const moduleSlugs = getModules()
    .map((m) => `${m.slug} (${m.title})`)
    .join(", ");
  return [
    "You can call tools, silently, whenever they make your answer more grounded:",
    "- read_article(slug): the full text of a learning article. Use it before answering in depth about something an article covers.",
    "- read_module(slug): know-how on one building block: what it is, setup steps, options and costs. Slugs: " +
      moduleSlugs +
      ".",
    "- fetch_page(url): the text of a public web page. Use it when the person shares a link.",
    "- visualize_flow(title, diagram): render a Mermaid flow, sequence, decision path, or relationship directly in the chat. Use it only when the visual is clearer than prose, keep it small, and follow it with a short explanation. Never use it to chart data: numeric results get the chart option of query_data instead.",
    `- attach_data(url): fetch a public data link (CSV, JSON, Parquet, Excel, or an API URL returning one of those) in the person's browser and register it as a queryable DuckDB table. Use it when a concrete data URL worth analyzing comes up: one the person mentions, one from a page you fetched, or a sample URL from a dataset briefing. The schema comes back in a follow-up message and query_data becomes available; at most ${MAX_DATASETS} datasets fit in one conversation. If the site blocks the browser download, ask the person to download the file and attach it with the tools button instead. For a person's own exports (Spotify, Strava, Goodreads) there is no URL to attach: they must always upload the file themselves.`,
    ...(freshReads
      ? [
          "- fresh_reads(topic?, content_type?): recent well-scored news, opinion pieces, and tutorials about AI and building things, from a curated reading feed. Use it when something current would enrich the answer, and share the best one or two as markdown links.",
        ]
      : []),
    ...(hasDatasets
      ? [
          `- query_data(sql, chart?): run DuckDB SQL against the datasets the person attached (listed below). The query runs in their browser and a table appears in the chat automatically; the result comes back to you in a follow-up message capped at ${RESULT_MAX_ROWS} rows, so aggregate (GROUP BY, LIMIT) rather than selecting everything. Pass chart {type: line|scatter|bar, x, y, title} when a trend or comparison is clearer as a visual, and always when the person asks for a chart; the x and y must be columns of the query result. This is the only way to chart data (never Mermaid). The chart appears on the person's screen automatically, just like the table: never point at it with a bracketed placeholder such as "[chart of x by year]", simply talk about what it shows. Column types come from how the CSV was sniffed, so a date stored as text (e.g. "21-JUN-07") stays VARCHAR: parse it with strptime(col, '%d-%b-%y'), not CAST AS DATE, which fails on non-ISO formats. After the result arrives, state the key numbers plainly and briefly; never invent values you have not seen. If the result reports an error, change the SQL (do not resend the same query) and try again.`,
        ]
      : []),
    "Prefer one well-chosen tool call over none when facts matter; never call more than needed. Do not mention tool names to the person.",
  ].join("\n");
}

export function buildSystemPrompt(
  contextItems: WireContextItem[],
  currentPage?: string,
  opts: {
    tools?: boolean;
    freshReads?: boolean;
    datasets?: WireDataset[];
  } = {},
) {
  const datasets = (opts.datasets ?? []).slice(0, MAX_DATASETS);
  const articleIndex = getArticles()
    .map(
      (a) =>
        `- [${a.title}](/learning/${a.slug}) (${a.category}, ${a.level}): ${a.description}`,
    )
    .join("\n");

  const datasetIndex = datasetCatalog
    .map(
      (d) =>
        `- ${d.title} (${d.tag}, ${d.formats.join("/")}): ${d.description}`,
    )
    .join("\n");

  const pageDescription = describePage(currentPage);
  const currentPageRule = pageDescription
    ? `The person is currently looking at ${pageDescription}`
    : "You do not know which page the person is on.";

  let prompt = promptTemplate
    .replace("{{MODULES}}", modules.join(", "))
    .replace("{{ARTICLE_INDEX}}", articleIndex)
    .replace("{{DATASETS}}", datasetIndex)
    .replace("{{CURRENT_PAGE_RULE}}", currentPageRule)
    .replace("{{AUDIENCE}}", buildAudienceSection())
    .replace(
      "{{TOOLS_RULE}}",
      buildToolsRule(
        opts.tools ?? false,
        opts.freshReads ?? false,
        datasets.length > 0,
      ),
    )
    .replace(/\n{3,}/g, "\n\n");

  if (datasets.length > 0) {
    const blocks = datasets
      .map((d) => d.summary.slice(0, DATASET_SUMMARY_MAX_CHARS))
      .join("\n\n");
    prompt += `\n\nThese datasets are attached to the conversation (by the person, or by your attach_data calls). They live only in their browser as DuckDB tables; the query_data tool is the only way to read them:\n\n${blocks}`;
  }

  if (contextItems.length > 0) {
    const blocks = contextItems
      .map(
        (item) =>
          `<context kind="${item.kind}" label=${JSON.stringify(item.label)}>\n${item.content.slice(0, CONTEXT_ITEM_MAX_CHARS)}\n</context>`,
      )
      .join("\n\n");
    prompt += `\n\nThe person brought this content into the conversation. Treat it as what they are currently looking at:\n\n${blocks}`;
  }

  return prompt;
}

/**
 * Keep the tail of the conversation within budget. Assistant text is
 * compacted (tool notes dropped, past query markers become one-liners);
 * `data` messages become user-role result envelopes for the model.
 */
export function trimHistory(messages: WireMessage[]): WireMessage[] {
  return messages.slice(-HISTORY_LIMIT).map((m) => {
    if (m.role === "data") {
      const content = m.content.slice(0, MESSAGE_MAX_CHARS);
      if (parseAttachEnvelope(m.content)) {
        return {
          role: "user" as const,
          content: `<attach_result>\n${content}\n</attach_result>\nThis is the result of your attach_data call, run in the person's browser. If the status is ok, the dataset is attached: a confirmation chip is already shown on their screen, the schema summary above is what you know about the table, and query_data can now read it. Briefly say in plain language what arrived (what one row is, which columns look interesting), then either run one obvious first query_data call or ask what they want to explore; do not restate the whole schema. If the status is an error, say so simply, do NOT claim the data is attached, and suggest they download the file and attach it with the tools button instead.`,
        };
      }
      return {
        role: "user" as const,
        content: `<query_results>\n${content}\n</query_results>\nThese are the results of your query_data call, run in the person's browser. The result table, and the chart if you asked for one, are ALREADY displayed on their screen, so your job now is only to talk about them. Reply in plain conversational prose, quoting the actual values (real numbers, names, dates). Do NOT re-run or restate the query, do NOT output SQL, "chart=", brackets, "query result", or any tool syntax, and do NOT offer to draw a chart that is already shown. If the result is an error, briefly say so and call query_data again with corrected SQL; otherwise do not query again.`,
      };
    }
    return {
      role: m.role,
      content: (m.role === "assistant"
        ? toModelText(m.content)
        : m.content
      ).slice(0, MESSAGE_MAX_CHARS),
    };
  });
}

export type StreamRound = {
  /** Concatenated content deltas of this round. */
  text: string;
  /** Completed tool calls, if the model asked for any. */
  toolCalls: ToolCall[];
  finishReason: string | null;
};

type SseDelta = {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
};

/**
 * Consume one OpenRouter SSE response stream. Content deltas are forwarded
 * to onText as they arrive; tool-call fragments are accumulated by index.
 * Resolves when the stream ends.
 */
export async function readSseRound(
  body: ReadableStream<Uint8Array>,
  onText: (delta: string) => void,
): Promise<StreamRound> {
  const round: StreamRound = { text: "", toolCalls: [], finishReason: null };
  const partial = new Map<number, ToolCall>();

  const handleLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return;
    let parsed: SseDelta;
    try {
      parsed = JSON.parse(data) as SseDelta;
    } catch {
      return; // Ignore malformed SSE lines (comments, keep-alives).
    }
    const choice = parsed.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) round.finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) return;
    if (delta.content) {
      round.text += delta.content;
      onText(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const entry = partial.get(tc.index) ?? {
        id: "",
        name: "",
        arguments: "",
      };
      if (tc.id) entry.id = tc.id;
      if (tc.function?.name) entry.name = tc.function.name;
      if (tc.function?.arguments) entry.arguments += tc.function.arguments;
      partial.set(tc.index, entry);
    }
  };

  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  if (buffer) handleLine(buffer);

  round.toolCalls = [...partial.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call)
    .filter((call) => call.id && call.name);
  return round;
}
