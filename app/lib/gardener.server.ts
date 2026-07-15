import { getArticle, getArticles } from "./content";
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

const modules = [
  "CSV file",
  "Google Sheet",
  "photos or scans",
  "dashboard",
  "game",
  "summarizer",
  "content finder",
];

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
  const name = pageNames[page];
  return name ? `${name} (${page}).` : `${page}.`;
}

export function buildSystemPrompt(
  contextItems: WireContextItem[],
  currentPage?: string,
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
    .replace("{{CURRENT_PAGE_RULE}}", currentPageRule);

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

/** Keep the tail of the conversation within budget. */
export function trimHistory(messages: WireMessage[]): WireMessage[] {
  return messages.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.role,
    content: m.content.slice(0, MESSAGE_MAX_CHARS),
  }));
}

/**
 * Transforms an OpenRouter SSE stream into a plain text stream of content
 * deltas. Calls onDone with the accumulated text when the stream ends.
 */
export function sseToTextStream(onDone: (fullText: string) => Promise<void>) {
  let buffer = "";
  let full = "";

  const handleLine = (
    line: string,
    controller: TransformStreamDefaultController<string>,
  ) => {
    if (!line.startsWith("data: ")) return;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data) as {
        choices?: { delta?: { content?: string } }[];
      };
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        controller.enqueue(delta);
      }
    } catch {
      // Ignore malformed SSE lines (comments, keep-alives).
    }
  };

  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line, controller);
    },
    async flush(controller) {
      if (buffer) handleLine(buffer, controller);
      try {
        await onDone(full);
      } catch (e) {
        console.error("failed to persist assistant message", e);
      }
    },
  });
}
