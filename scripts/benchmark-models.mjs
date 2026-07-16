#!/usr/bin/env node
/**
 * Benchmark candidate Gardener models against OpenRouter using
 * production-shaped requests: the real system prompt (placeholders filled
 * from content/, like gardener.server.ts does), the real tool definitions,
 * and the same tool-round loop as app/routes/api.chat.ts.
 *
 * Measures, per model x scenario x trial:
 *   - ttfb_ms: first SSE delta of round 1 (model starts responding)
 *   - ttft_ms: first visible text delta (what a person perceives)
 *   - total_ms: until the final answer round finishes
 *   - tokens, cost, provider, and OpenRouter-measured generation stats
 *     (via GET /api/v1/generation per round)
 *   - tool behavior: which tools were called, with which arguments
 *
 * Usage:
 *   node scripts/benchmark-models.mjs [--trials 3] [--models id1,id2]
 *
 * Reads OPENROUTER_API_KEY from env or .dev.vars. Writes JSON results to
 * scripts/benchmark-results/.
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- config ----------

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const TRIALS = Number(flag("trials", "3"));

const DEFAULT_MODELS = [
  "moonshotai/kimi-k2.6",
  "minimax/minimax-m3",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-pro",
  "qwen/qwen3.7-plus",
  "google/gemma-4-26b-a4b-it:free",
];
const MODELS = flag("models", "").split(",").filter(Boolean).length
  ? flag("models", "").split(",").filter(Boolean)
  : DEFAULT_MODELS;

const MAX_TOOL_ROUNDS = 3; // same as api.chat.ts
const TOOL_RESULT_MAX_CHARS = 12_000;

function apiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const devVars = join(root, ".dev.vars");
  if (existsSync(devVars)) {
    const m = readFileSync(devVars, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("OPENROUTER_API_KEY not found in env or .dev.vars");
}
const KEY = apiKey();

// ---------- production-shaped system prompt ----------

function frontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return [{}, raw];
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return [fm, raw.slice(m[0].length)];
}

function readContentDir(dir) {
  return readdirSync(join(root, "content", dir))
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => {
      const raw = readFileSync(join(root, "content", dir, f), "utf8");
      const [fm, body] = frontmatter(raw);
      return { slug: f.replace(/\.mdx$/, ""), ...fm, body };
    })
    .sort((a, b) => Number(a.order ?? 99) - Number(b.order ?? 99) || String(a.title).localeCompare(String(b.title)));
}

const articles = readContentDir("learning");
const modules = readContentDir("modules");

function buildSystemPrompt(currentPageRule) {
  const template = readFileSync(join(root, "content", "gardener", "system-prompt.md"), "utf8");
  let audience = "";
  const audiencePath = join(root, "content", "gardener", "audience.md");
  if (existsSync(audiencePath)) {
    const raw = readFileSync(audiencePath, "utf8");
    const [fm, body] = frontmatter(raw);
    if (fm.enabled !== "false") audience = body.trim();
  }
  const articleIndex = articles
    .map((a) => `- [${a.title}](/learning/${a.slug}) (${a.category}, ${a.level}): ${a.description}`)
    .join("\n");
  const moduleSlugs = modules.map((m) => `${m.slug} (${m.title})`).join(", ");
  const toolsRule = [
    "You can call tools, silently, whenever they make your answer more grounded:",
    "- read_article(slug): the full text of a learning article. Use it before answering in depth about something an article covers.",
    "- read_module(slug): know-how on one building block: what it is, setup steps, options and costs. Slugs: " + moduleSlugs + ".",
    "- fetch_page(url): the text of a public web page. Use it when the person shares a link.",
    "- visualize_flow(title, diagram): render a Mermaid flow, sequence, decision path, or relationship directly in the chat. Use it only when the visual is clearer than prose, keep it small, and follow it with a short explanation.",
    "- fresh_reads(topic?, content_type?): recent well-scored news, opinion pieces, and tutorials about AI and building things, from a curated reading feed. Use it when something current would enrich the answer, and share the best one or two as markdown links.",
    "Prefer one well-chosen tool call over none when facts matter; never call more than needed. Do not mention tool names to the person.",
  ].join("\n");

  return template
    .replace("{{MODULES}}", modules.map((m) => m.title).join(", "))
    .replace("{{ARTICLE_INDEX}}", articleIndex)
    .replace("{{CURRENT_PAGE_RULE}}", currentPageRule)
    .replace("{{AUDIENCE}}", audience)
    .replace("{{TOOLS_RULE}}", toolsRule)
    .replace(/\n{3,}/g, "\n\n");
}

// ---------- tool definitions (mirrors gardener-tools.server.ts) ----------

const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "read_article",
      description:
        "Read the full text of a learning article from this site. Use it before answering in depth about a topic an article covers, or when the person asks about an article.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string", description: 'Article slug, e.g. "what-is-an-llm".' } },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_module",
      description:
        "Read the know-how notes for one of the site's building blocks (what it is, when to use it, setup steps, options and costs). Use it when a project idea involves that block.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string", description: 'Building block slug, e.g. "google-sheet".' } },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_page",
      description:
        "Fetch a public web page and return its text content. Use it when the person shares a URL or when a specific page would ground the answer. Not a search engine: it needs a full URL.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Full http(s) URL of the page to fetch." } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "visualize_flow",
      description:
        "Render a Mermaid diagram directly in the chat. Use it when a flow, sequence, decision path, or relationship is materially clearer as a visual. Keep the diagram small, readable, and useful to someone who may not program.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "A short human-readable title for the diagram." },
          diagram: { type: "string", description: "Valid Mermaid source, including its diagram type." },
        },
        required: ["title", "diagram"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fresh_reads",
      description:
        "Recent worthwhile reads from Dumky's curated RSS feed: news, opinion pieces, and tutorials about AI and building things, scored for interestingness. Use it to point at something current, or when the person asks what is happening in AI right now.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Optional free-text filter matched against title, summary, and key insight." },
          content_type: { type: "string", enum: ["news", "opinion", "tutorial"], description: "Optional: limit to one kind. Omit for all three." },
        },
      },
    },
  },
];

function executeTool(call) {
  let parsed = {};
  try {
    parsed = JSON.parse(call.arguments || "{}");
  } catch {
    return "Error: tool arguments were not valid JSON.";
  }
  const cap = (t) => (t.length > TOOL_RESULT_MAX_CHARS ? t.slice(0, TOOL_RESULT_MAX_CHARS) + "\n\n[truncated]" : t);
  if (call.name === "read_article") {
    const a = articles.find((x) => x.slug === parsed.slug);
    return a ? cap(a.body.trim()) : `Error: no article with slug "${parsed.slug}".`;
  }
  if (call.name === "read_module") {
    const m = modules.find((x) => x.slug === parsed.slug);
    return m ? cap(m.body.trim()) : `Error: no building block with slug "${parsed.slug}".`;
  }
  if (call.name === "visualize_flow") return "The diagram was rendered in the chat.";
  if (call.name === "fetch_page") return "Error: the page could not be fetched (timeout or network error).";
  if (call.name === "fresh_reads")
    return JSON.stringify([
      {
        title: "Small models are getting good enough",
        url: "https://example.com/small-models",
        content_type: "opinion",
        summary: "Why sub-10B open models now cover most everyday assistant tasks.",
      },
      {
        title: "A gentle intro to tool calling",
        url: "https://example.com/tool-calling",
        content_type: "tutorial",
        summary: "How LLMs decide to call functions and what can go wrong.",
      },
    ]);
  return `Error: unknown tool "${call.name}".`;
}

// ---------- scenarios ----------

const SCENARIOS = [
  {
    id: "concept",
    label: "Conceptual question",
    currentPageRule: "The person is currently looking at the learning index (/learning).",
    messages: [
      {
        role: "user",
        content:
          "What's the difference between an AI agent and just a normal automation? I keep hearing 'agent' everywhere.",
      },
    ],
  },
  {
    id: "grounding",
    label: "Article-grounded explanation",
    currentPageRule: "You do not know which page the person is on.",
    expectTool: "read_article",
    messages: [
      {
        role: "user",
        content:
          "I read something about embeddings yesterday but I still don't really get what they are. Can you explain it like I'm not a programmer?",
      },
    ],
  },
  {
    id: "brainstorm",
    label: "Project brainstorm turn",
    currentPageRule: "The person is currently looking at the Idea Garden (/garden).",
    messages: [
      { role: "user", content: "I want to build something for my book club but I'm not sure what." },
      {
        role: "assistant",
        content: "Lovely soil to dig in! What's the most annoying part of running the book club right now?",
      },
      {
        role: "user",
        content:
          "Honestly, picking the next book. Everyone drops suggestions in the group chat and it all gets lost. Could I build something for that?",
      },
    ],
  },
];

// ---------- OpenRouter plumbing ----------

async function chatRound(model, messages, withTools) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Vibe Garden benchmark",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages,
      ...(withTools ? { tools: toolDefinitions } : {}),
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

/** Consume one SSE stream; returns text, tool calls, gen id, and timing marks. */
async function readRound(body, marks) {
  const round = { text: "", toolCalls: [], genId: null };
  const partial = new Map();
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const handle = (line) => {
    if (!line.startsWith("data: ")) return;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (marks.ttfb == null) marks.ttfb = performance.now();
    if (parsed.id) round.genId = parsed.id;
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      if (marks.ttft == null) marks.ttft = performance.now();
      round.text += delta.content;
    }
    for (const tc of delta.tool_calls ?? []) {
      const entry = partial.get(tc.index) ?? { id: "", name: "", arguments: "" };
      if (tc.id) entry.id = tc.id;
      if (tc.function?.name) entry.name = tc.function.name;
      if (tc.function?.arguments) entry.arguments += tc.function.arguments;
      partial.set(tc.index, entry);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  if (buffer) handle(buffer);
  round.toolCalls = [...partial.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, c]) => c)
    .filter((c) => c.id && c.name);
  return round;
}

/** OpenRouter's own metering for a generation: cost, native tokens, timings. */
async function generationStats(id) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 800 : 1500));
    const res = await fetch(`https://openrouter.ai/api/v1/generation?id=${id}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    if (res.ok) {
      const { data } = await res.json();
      return {
        provider: data.provider_name,
        cost: data.total_cost,
        tokens_prompt: data.native_tokens_prompt,
        tokens_completion: data.native_tokens_completion,
        tokens_reasoning: data.native_tokens_reasoning ?? 0,
        generation_ms: data.generation_time,
        or_latency_ms: data.latency,
      };
    }
  }
  return null;
}

// ---------- trial runner ----------

async function runTrial(model, scenario) {
  const system = buildSystemPrompt(scenario.currentPageRule);
  const messages = [{ role: "system", content: system }, ...scenario.messages];
  const marks = { ttfb: null, ttft: null };
  const start = performance.now();
  const genIds = [];
  const toolCalls = [];
  let finalText = "";
  let rounds = 0;

  let response = await chatRound(model, messages, true);
  for (let round = 0; ; round++) {
    rounds++;
    const result = await readRound(response.body, marks);
    if (result.genId) genIds.push(result.genId);
    finalText = result.text || finalText;
    if (result.toolCalls.length === 0) break;
    toolCalls.push(...result.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments })));
    messages.push({
      role: "assistant",
      content: result.text || null,
      tool_calls: result.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      })),
    });
    for (const call of result.toolCalls) {
      messages.push({ role: "tool", tool_call_id: call.id, content: executeTool(call) });
    }
    response = await chatRound(model, messages, round + 1 < MAX_TOOL_ROUNDS);
  }
  const total = performance.now() - start;

  const gens = [];
  for (const id of genIds) gens.push(await generationStats(id));
  const known = gens.filter(Boolean);
  const cost = known.reduce((s, g) => s + (g.cost ?? 0), 0);
  const tokensOut = known.reduce((s, g) => s + (g.tokens_completion ?? 0), 0);
  const tokensReasoning = known.reduce((s, g) => s + (g.tokens_reasoning ?? 0), 0);
  const genMs = known.reduce((s, g) => s + (g.generation_ms ?? 0), 0);

  return {
    model,
    scenario: scenario.id,
    ttfb_ms: marks.ttfb ? marks.ttfb - start : null,
    ttft_ms: marks.ttft ? marks.ttft - start : null,
    total_ms: total,
    rounds,
    tool_calls: toolCalls,
    cost_usd: cost,
    tokens_out: tokensOut,
    tokens_reasoning: tokensReasoning,
    throughput_tps: genMs > 0 ? tokensOut / (genMs / 1000) : null,
    providers: [...new Set(known.map((g) => g.provider))],
    answer_chars: finalText.length,
    answer: finalText,
  };
}

async function runModel(model) {
  const results = [];
  for (const scenario of SCENARIOS) {
    for (let t = 0; t < TRIALS; t++) {
      const label = `${model} / ${scenario.id} / trial ${t + 1}`;
      try {
        const r = await runTrial(model, scenario);
        results.push(r);
        console.log(
          `${label}: ttft ${r.ttft_ms?.toFixed(0)}ms, total ${(r.total_ms / 1000).toFixed(1)}s, ` +
            `${r.tokens_out} tok out, $${r.cost_usd.toFixed(5)}, tools [${r.tool_calls.map((c) => c.name).join(", ")}]`,
        );
      } catch (e) {
        console.error(`${label}: FAILED: ${e.message}`);
        results.push({ model, scenario: scenario.id, error: e.message });
      }
    }
  }
  return results;
}

// ---------- main ----------

console.log(`Benchmarking ${MODELS.length} models, ${SCENARIOS.length} scenarios, ${TRIALS} trials each.\n`);
// Strictly sequential: parallel streams contend (locally or at OpenRouter)
// and inflate every timing measurement.
const all = [];
for (const model of MODELS) all.push(...(await runModel(model)));

const outDir = join(root, "scripts", "benchmark-results");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = join(outDir, `results-${stamp}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      ran_at: new Date().toISOString(),
      trials: TRIALS,
      models: MODELS,
      scenarios: SCENARIOS.map((s) => ({ id: s.id, label: s.label, expectTool: s.expectTool ?? null })),
      results: all,
    },
    null,
    2,
  ),
);
console.log(`\nWrote ${outPath}`);
