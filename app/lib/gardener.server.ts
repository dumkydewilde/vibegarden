import { getArticle, getArticles } from "./content";
import { getModule, getModules, modules } from "./modules";
import { stripToolNotes } from "./tool-notes";
import type { ToolCall } from "./gardener-tools.server";
import promptTemplate from "../../content/gardener/system-prompt.md?raw";

export type WireMessage = { role: "user" | "assistant"; content: string };
export type WireContextItem = {
  kind: "page" | "article" | "paragraph" | "project" | "dataset";
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

function buildToolsRule(toolsEnabled: boolean, freshReads: boolean) {
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
    "- visualize_flow(title, diagram): render a Mermaid flow, sequence, decision path, or relationship directly in the chat. Use it only when the visual is clearer than prose, keep it small, and follow it with a short explanation.",
    ...(freshReads
      ? [
          "- fresh_reads(topic?, content_type?): recent well-scored news, opinion pieces, and tutorials about AI and building things, from a curated reading feed. Use it when something current would enrich the answer, and share the best one or two as markdown links.",
        ]
      : []),
    "Prefer one well-chosen tool call over none when facts matter; never call more than needed. Do not mention tool names to the person.",
  ].join("\n");
}

export function buildSystemPrompt(
  contextItems: WireContextItem[],
  currentPage?: string,
  opts: { tools?: boolean; freshReads?: boolean } = {},
) {
  const articleIndex = getArticles()
    .map(
      (a) =>
        `- [${a.title}](/learning/${a.slug}) (${a.category}, ${a.level}): ${a.description}`,
    )
    .join("\n");

  const pageDescription = describePage(currentPage);
  const currentPageRule = pageDescription
    ? `The person is currently looking at ${pageDescription}`
    : "You do not know which page the person is on.";

  let prompt = promptTemplate
    .replace("{{MODULES}}", modules.join(", "))
    .replace("{{ARTICLE_INDEX}}", articleIndex)
    .replace("{{CURRENT_PAGE_RULE}}", currentPageRule)
    .replace(
      "{{TOOLS_RULE}}",
      buildToolsRule(opts.tools ?? false, opts.freshReads ?? false),
    );

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

/** Keep the tail of the conversation within budget, minus tool notes. */
export function trimHistory(messages: WireMessage[]): WireMessage[] {
  return messages.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.role,
    content: (m.role === "assistant"
      ? stripToolNotes(m.content)
      : m.content
    ).slice(0, MESSAGE_MAX_CHARS),
  }));
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
      const entry = partial.get(tc.index) ?? { id: "", name: "", arguments: "" };
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
