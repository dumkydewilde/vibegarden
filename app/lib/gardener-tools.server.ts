import { getArticle, getArticleRaw, getArticles } from "./content";
import { getModule, getModuleRaw, getModules } from "./modules";
import { toolNote } from "./tool-notes";

/**
 * First-party tools the Gardener can call mid-conversation. Definitions are
 * in the OpenAI function-calling format OpenRouter forwards to models.
 */

export const TOOL_RESULT_MAX_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 10_000;

export type ToolCall = {
  id: string;
  name: string;
  /** Raw JSON string, as accumulated from the stream. */
  arguments: string;
};

export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "read_article",
      description:
        "Read the full text of a learning article from this site. Use it before answering in depth about a topic an article covers, or when the person asks about an article.",
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
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_module",
      description:
        "Read the know-how notes for one of the site's building blocks (what it is, when to use it, setup steps, options and costs). Use it when a project idea involves that block.",
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
    },
  },
  {
    type: "function" as const,
    function: {
      name: "fetch_page",
      description:
        "Fetch a public web page and return its text content. Use it when the person shares a URL or when a specific page would ground the answer. Not a search engine: it needs a full URL.",
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
    },
  },
];

/** Strip MDX frontmatter; the model gets the prose, not the metadata. */
function stripFrontmatter(raw: string) {
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

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

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export async function executeTool(call: ToolCall): Promise<string> {
  const args = parseArgs(call.arguments);
  if (!args) return "Error: tool arguments were not valid JSON.";

  switch (call.name) {
    case "read_article": {
      const slug = String(args.slug ?? "");
      const raw = getArticleRaw(slug);
      if (!raw) {
        const known = getArticles()
          .map((a) => a.slug)
          .join(", ");
        return `Error: no article with slug "${slug}". Available slugs: ${known}.`;
      }
      return stripFrontmatter(raw).slice(0, TOOL_RESULT_MAX_CHARS);
    }
    case "read_module": {
      const slug = String(args.slug ?? "");
      const raw = getModuleRaw(slug);
      if (!raw) {
        const known = getModules()
          .map((m) => m.slug)
          .join(", ");
        return `Error: no building block with slug "${slug}". Available slugs: ${known}.`;
      }
      return stripFrontmatter(raw).slice(0, TOOL_RESULT_MAX_CHARS);
    }
    case "fetch_page":
      return fetchPage(String(args.url ?? ""));
    default:
      return `Error: unknown tool "${call.name}".`;
  }
}

/**
 * The tool-note marker streamed into the chat while a tool runs; the UI
 * turns it into its own little bubble (see app/lib/tool-notes.ts).
 */
export function toolNoteFor(call: ToolCall): string {
  const args = parseArgs(call.arguments) ?? {};
  switch (call.name) {
    case "read_article": {
      const slug = String(args.slug ?? "");
      return getArticle(slug)
        ? toolNote("article", slug)
        : toolNote("note", "looking for an article");
    }
    case "read_module": {
      const slug = String(args.slug ?? "");
      return getModule(slug)
        ? toolNote("module", slug)
        : toolNote("note", "looking for a building block");
    }
    case "fetch_page": {
      try {
        return toolNote("web", new URL(String(args.url ?? "")).hostname);
      } catch {
        return toolNote("note", "fetching a page");
      }
    }
    default:
      return toolNote("note", `using ${call.name}`);
  }
}
