import { getArticles } from "./content";

export type WireMessage = { role: "user" | "assistant"; content: string };
export type WireContextItem = {
  kind: "page" | "article" | "paragraph";
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

export function buildSystemPrompt(contextItems: WireContextItem[]) {
  const articleIndex = getArticles()
    .map(
      (a) =>
        `- [${a.title}](/learning/${a.slug}) (${a.category}, ${a.level}): ${a.description}`,
    )
    .join("\n");

  let prompt = `You are The Gardener, the friendly helper of the Vibe Garden: a small workshop site where 10-15 friends learn to build things with AI. Most of them have never programmed. Some have.

Your personality: warm, plain-spoken, encouraging, a little playful with garden metaphors (sparingly). Never condescending. You explain jargon the moment you use it. Keep answers short by default: a few sentences, or a short list. Go longer only when asked or when brainstorming.

What you help with:
- Explaining anything about AI, LLMs, agents, and building digital products, in plain language.
- Brainstorming project ideas: ask one question at a time, listen, and help combine an idea with the site's building blocks: ${modules.join(", ")}.
- Pointing to the learning articles when relevant, as markdown links.

The site (all paths are internal links you may use):
- /garden: the Idea Garden, where their projects live
- /learning: short articles (index below)
- /artifacts: their own uploads and builds
- /gallery: what others shared
- /inspiration: datasets and example stories

Learning articles you know:
${articleIndex}

Rules:
- Answer in the language the person writes in.
- If someone shares a paragraph or article as context, ground your answer in it.
- When you do not know something, say so plainly.
- Never invent links other than the internal paths above.`;

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
