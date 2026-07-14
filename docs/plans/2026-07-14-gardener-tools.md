# Gardener tools: core increment

Covers the first four bullets of the "Gardener tools" roadmap section: module
know-how content, the tool-calling loop, first-party tools, and the web access
toggle. DuckDB-WASM and MotherDuck MCP are separate, later chunks.

Decisions folded in:

- **Streaming protocol stays plain text.** Tool activity is surfaced as small
  italic markdown markers in the stream (e.g. `*reading "What is an LLM"*`),
  which also land in the persisted transcript. Transparent, zero client
  protocol change.
- **Web access uses the OpenRouter `plugins: [{ id: "web" }]` param**, not the
  `:online` model suffix, so it composes with tool calling and model ids stay
  clean. Works for every model, including Gemma.
- **Tool support is a per-model flag** in `app/lib/models.ts`. Kimi, DeepSeek,
  Qwen: yes. Free Gemma: no, the `tools` param is simply omitted (graceful
  degradation per roadmap).
- **Module names become content-driven.** `content/modules/*.mdx` frontmatter
  is the single source of truth; `app/lib/modules.ts` derives the display-name
  list the project forms already use.
- **Loop cap:** 4 rounds; the final allowed round omits `tools` so the model
  must produce text.

## Steps

1. `content/modules/*.mdx`, seven files (csv-file, google-sheet,
   photos-or-scans, dashboard, game, summarizer, content-finder) with
   frontmatter (title, description, order) and sections: what it is, when to
   use it, setup steps, options and costs.
2. `app/lib/modules.ts`: glob the MDX (component + raw), export
   `getModules()`, `getModule(slug)`, `getModuleRaw(slug)`, keep
   `modules` (titles) and `isModuleName` working.
3. Drill-down route `/garden/modules/:slug` mirroring the learning article
   page (prose, paragraph-ask, discuss button), plus a compact "Building
   blocks" section on /garden linking to it.
4. `app/lib/gardener-tools.server.ts`: OpenAI-format tool definitions and
   `executeTool` for `read_article(slug)`, `read_module(slug)`,
   `fetch_page(url)` (http/https only, 10s timeout, HTML stripped, ~20k char
   cap). Unknown slugs return the list of valid ones so the model can retry.
5. `app/lib/gardener.server.ts`: replace `sseToTextStream` with a round
   parser that accumulates text deltas, tool_call deltas, and finish_reason;
   `buildSystemPrompt` gains a `{{TOOLS_RULE}}` placeholder and knows about
   module pages in `describePage`.
6. `app/routes/api.chat.ts`: tool loop. First upstream request still happens
   before the Response is created (existing 502 behavior preserved); further
   rounds run inside the stream pump.
7. Client: `webSearch` state in the Gardener provider, globe toggle in the
   composer, `web` flag in the POST body. Off by default.
8. System prompt: building-blocks section with `/garden/modules/...` links,
   tools rule. Update CLAUDE.md placeholder list and ROADMAP checkboxes.
9. Tests: round parser (text only, tool calls split across deltas), tool
   execution (article found, unknown slug, bad URL), prompt rules. Then
   typecheck, test, build, and a dev-server pass.
