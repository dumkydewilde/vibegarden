# Agent core extraction: one harness, many surfaces

Status: phase 2 complete, 2026-07-17

Extract the Gardener's agent harness into a reusable package that can power
(1) the Gardener as it is today, (2) an assistant embedded in a docs site,
(3) a chat bot on a plain-text surface like Signal, and (4) an MCP server
exposing the tools (or the whole agent) to other clients.

## What we learned from the current design

The harness is already close to generic. The load-bearing pieces:

- `readSseRound` (gardener.server.ts): OpenAI-format SSE reader that
  accumulates streamed tool calls. Runtime-neutral (fetch + web streams).
- The chat loop (api.chat.ts): up to N tool rounds, tools withheld on the
  last round, one plain-text stream out.
- The `[[tool:...]]` marker protocol (tool-notes.ts): tool activity,
  diagrams, query requests and results all travel inside the text stream,
  and the same module compacts them for model-bound history.
- Delegated execution: a valid `query_data` call ends the server turn with
  a marker; the browser runs the SQL in DuckDB-WASM and sends the result
  back as a `data` message in a continuation request.

Two assumptions block reuse beyond the web app, and they are the core of
this design:

1. **Markers assume a streaming rich-text surface.** Signal has no
   streaming and no Mermaid; MCP wants structured results, not markers.
2. **`query_data` assumes a browser on the other end.** A Signal bot or
   MCP server has no client to delegate to.

## Design

### 1. Events at the core boundary, markers as the web wire format

The core stops producing marker text and produces a typed event stream:

```ts
type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "note"; kind: string; value: string }        // tool activity
  | { type: "diagram"; title: string; mermaid: string }
  | { type: "delegated-call"; tool: string; args: unknown } // turn suspends
  | { type: "done"; finishReason: string | null };

runTurn(config, messages, ctx): AsyncIterable<AgentEvent>
```

The marker protocol does not go away: it becomes the *web surface's
serialization* of these events (unchanged on the wire, so the existing UI,
persistence rows, and history compaction keep working). Other surfaces
consume the events directly. `toModelText`/`trimHistory` already operate on
parsed segments, so history compaction moves into the core untouched.

### 2. Neutral tool spec, per-surface binding

Tools are defined once in a provider-neutral shape and bound per surface
(shape below matches what phase 1 landed in `app/lib/agent/tools.ts`;
`promptGuidance` and `requires` are the planned extensions):

```ts
type ToolSpec = {
  name: string;
  description: string;                          // JSON-schema level, terse
  parameters: JSONSchema;
  execute: (args) => Promise<string> | string;  // returns "Error: ..." rather than throwing
  delegate?: (args) => unknown | null;          // valid payload suspends the turn
  noteFor?: (args) => AgentEvent | null;        // activity note / diagram event
  promptGuidance?: string;                      // usage prose for the system prompt
  requires?: (keyof Capabilities)[];            // later: gate by surface capability
};
```

Adapters map this to the OpenAI function format (for OpenRouter) and to
MCP tool schemas. A tool can have different bindings per surface: same
`query_data` definition, a `delegate` binding on the web (DuckDB-WASM),
a server-side executor elsewhere.

`promptGuidance` exists because per-tool usage guidance is longer than a
schema description (query_data's aggregation limits, strptime-vs-CAST
advice, error-retry rule) and today lives in a hand-maintained
`buildToolsRule` list that parallels the specs. The core composes the
system prompt's tools section from the *offered* specs (guidance plus
capability-conditional wording), so the prompt and the tool list cannot
drift: gating a tool off automatically drops its prompt paragraph.

### 3. Surface capabilities drive tools and prompt

```ts
type Capabilities = {
  streaming: boolean;      // web: yes; signal: no; mcp: n/a
  markdown: boolean;       // signal: plain text with light styling
  mermaid: boolean;        // web renders client-side
  images: boolean;         // signal/mcp: attach rendered PNGs
  clientExec: boolean;     // web only: browser-delegated tools
  interactiveTables: boolean;
};
```

The registry filters tools by `requires` and the prompt builder adapts the
tools rule to what the surface can show ("a chart appears in the chat" vs
"a chart image will be attached"). This replaces today's ad-hoc booleans
(`toolsEnabled`, `freshReads`, `hasDatasets`).

**Prompt and knowledge ownership.** The core takes a finished
`systemPrompt` string (already true of `runTurn`); its only prompt job is
composing the tools section from the offered ToolSpecs plus capabilities.
Everything else in the Gardener's prompt is host content: the article
index, module list, dataset catalog, audience section, current-page rule,
and per-request context blocks stay in the app, and a docs site or Signal
bot brings its own equivalents. The "index in the prompt plus a read_*
tool" shape (article index + read_article today, search_docs/read_doc for
the docs site) is a convention hosts follow, not a core abstraction.

### 4. Visualizations off the web

- **visualize_flow (Mermaid):** where `mermaid: false` but `images: true`,
  render server-side to PNG via Kroki (self-hostable on the homelab) or
  mermaid.ink, and attach. Where neither, the tool is simply not offered;
  the model falls back to prose. MCP: return the Mermaid source as text
  plus an optional image content block, and let the client choose.
- **query_data charts:** same split. Web keeps the client-rendered mini
  chart; image surfaces render the chart server-side (QuickChart or a tiny
  plot-to-PNG endpoint) and attach it next to a text table.

### 5. query_data without a browser

The delegation mechanism stays (it is what makes the web version private:
data never leaves the browser). Non-web surfaces get a server executor:

- **Container runtimes (Signal bot on Coolify):** the `duckdb` Node binding
  against files the user attached in the conversation.
- **Workers runtimes:** no native DuckDB; route through MotherDuck over the
  Postgres endpoint (the `fresh_reads` path already does exactly this), or
  skip the tool.

The privacy trade-off (data leaves the device) is stated in the tool
description per binding so the model represents it honestly. The prompt
strings wired to delegation travel with the binding too: the
result-envelope narration instructions (today hardcoded in `trimHistory`)
and the "datasets live only in their browser" preamble belong to the web
binding; a server-side binding states its own execution model instead.

### 6. Non-streaming turns

Signal (and MCP "ask the agent") consume the same `runTurn` iterable and
just collect: text deltas buffer into one message, notes can drive a typing
indicator or be dropped, `done` triggers the send. No second code path;
buffering is the surface's choice.

### 7. Runtime and persistence seams

- Core depends only on fetch + web streams (already true); the Workers
  `Env` becomes a plain config object so the same package runs in a Worker,
  Node container, or Bun.
- Persistence becomes an optional `ThreadStore` interface (D1/Drizzle
  implementation for Vibe Garden; a Signal bot keys threads by chat id;
  the docs site may use none).
- Auth is the host app's job; the core takes an opaque principal.

## Package layout

```
packages/agent-core/        runTurn, readSseRound, events, history compaction,
                            tool registry, capabilities, tools-rule composition
                            (system prompts themselves are host content)
packages/agent-web/         marker serialization, query protocol,
                            duckdb.client (delegated browser execution)
packages/agent-mcp/         ToolSpec -> MCP server adapter (+ optional
                            "ask" tool wrapping runTurn)
app/                        Vibe Garden host prompt/tools, React provider,
                            rendered chat UI and route/persistence adapters
apps/…                      later: docs worker, signal bot container
```

## Phases

1. **Core extraction (2-3 days).** Introduce AgentEvent + ToolSpec inside
   this repo, refactor api.chat.ts and gardener-tools.server.ts onto them,
   web wire format unchanged. Existing tests keep passing; this is the
   proof the seam is right.
   *Status 2026-07-17:* complete. The code first landed in `app/lib/agent/`
   and now lives in `packages/agent-core/`: events, SSE, run-turn, and tools.
   `api.chat.ts` consumes events and the Gardener's tools are ToolSpecs. Tool
   prompt guidance lives on those specs and the system prompt is composed
   from the exact offered list, including the narrate-only continuation that
   intentionally offers zero tools.
2. **Package split (1-2 days).** Move core + web into workspace packages,
   Vibe Garden consumes them. `Env` -> config object.
   *Status 2026-07-17:* complete. The npm workspaces expose TypeScript source
   through `@vibegarden/agent-core` and `@vibegarden/agent-web`; Vite bundles
   them with the app. The Cloudflare route translates Worker bindings into
   plain Gardener/MotherDuck configuration. The provider and visual
   components stay in the host app until a second surface proves the right
   headless React interface.
3. **MCP adapter (about 1 day).** ToolSpec -> MCP tools; fresh_reads and
   fetch_page are immediately useful standalone.
4. **Second surface (3-5 days).** Signal bot container (signal-cli-rest-api
   webhook -> runTurn -> send), buffered turns, Kroki/QuickChart image
   rendering, server-side query_data via the Node duckdb binding. This is
   the real test of the capabilities model.
5. **Docs-site deployment** (separate plan): dedicated Worker, docs tools
   (search_docs, read_doc), public hardening (rate limiting, fetch_page
   allowlist, token caps).

## Non-goals

- Multi-provider model APIs beyond OpenAI-compatible endpoints (an
  Anthropic-native adapter is a later, contained change to readSseRound).
- Generalizing the persistence schema beyond a minimal ThreadStore.
- Voice or group-chat semantics on Signal (start with 1:1).
- Knowledge-base or RAG abstractions in the core. Indexes-in-prompt plus
  read tools stay a per-host convention; the core never learns what an
  "article" or a "doc" is.
