import { getArticle, getArticles } from "./content";
import { datasets as datasetCatalog } from "./inspiration-datasets";
import { getModule, modules } from "./modules";
import {
  DATASET_SUMMARY_MAX_CHARS,
  MAX_DATASETS,
  parseAttachEnvelope,
  toModelText,
} from "@vibegarden/agent-web";
import {
  composeToolsPrompt,
  type AgentHistoryMessage,
  type ToolSpec,
} from "@vibegarden/agent-core";
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

export function buildSystemPrompt(
  contextItems: WireContextItem[],
  currentPage?: string,
  opts: {
    tools?: ToolSpec[];
    toolsUnavailableMessage?: string;
    datasets?: WireDataset[];
  } = {},
) {
  const tools = opts.tools ?? [];
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
      composeToolsPrompt(
        tools,
        opts.toolsUnavailableMessage ??
          "You cannot read files or fetch pages in this conversation (the selected model does not support tools). Point at links instead.",
      ),
    )
    .replace(/\n{3,}/g, "\n\n");

  if (datasets.length > 0) {
    const blocks = datasets
      .map((d) => d.summary.slice(0, DATASET_SUMMARY_MAX_CHARS))
      .join("\n\n");
    const datasetRule = tools.some((tool) => tool.name === "query_data")
      ? "They live only in their browser as DuckDB tables; the query_data tool is the only way to read them"
      : "Their summaries are context only; no tool is available to read their rows in this turn";
    prompt += `\n\nThe person attached these datasets. ${datasetRule}:\n\n${blocks}`;
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
export function trimHistory(messages: WireMessage[]): AgentHistoryMessage[] {
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
