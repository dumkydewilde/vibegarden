# Agent Workbench design

Date: 2026-08-06
Status: approved (naming and tool-authoring decisions folded in)

The feature is called the **Agent Workbench** in all copy and navigation.

## Goal

Let club members build their own agents, a system prompt plus tools, skills,
and memory, inside a glass-box workbench where every step of a turn is
visible: the assembled system prompt, each tool call with its arguments, the
raw tool result (the full HTML soup of a fetched page), and the capped
envelope the model actually received. Agents are shareable within a club so
others can try them and remix them.

The pedagogical thesis: people learn what an agent is by seeing that a tool
result is not magic. Fetching a page yields 200KB of markup; the model only
sees a slice; you need a second tool to distill it; the Gardener can help you
write that tool.

## Non-goals (v1)

- Cross-club or public agent sharing.
- Persisting workbench test conversations server-side.
- Sharing individual tools between agents (an agent owns its tools).
- Arbitrary server-side code execution. All user code runs in the browser.
- MCP, streaming tool output, or multi-agent orchestration.

## Architecture overview

Everything reuses the existing three seams:

1. **`agent-core` turn loop** (`packages/agent-core/src/run-turn.ts`): the
   `delegate` mechanism already ends a turn with a `delegated-call` event that
   the browser fulfills and resumes via a continuation request. User tools and
   the built-in fetch tool are all delegated tools.
2. **`agent-web` marker protocol** (`packages/agent-web/src/markers.ts`): the
   `query`/`queryresult` marker pair generalizes to a `call`/`callresult`
   pair for workbench tools.
3. **The usercontent origin** (`workers/renderer.ts`,
   `usercontent.vibegarden.club`): hosts the sandboxed tool runner, the same
   trust boundary that already runs untrusted gallery artifacts.

The only new server-side execution surface is a small authenticated fetch
proxy with SSRF guards. Model calls keep flowing through the existing club
credential and model policy path (`resolveClubModel`,
`getClubChatCredential`).

```
Workbench page (vibegarden.club)
  ├── definition editor (prompt, tools, skills, builtins)
  ├── test chat + trace view
  ├── Gardener sidekick panel (existing /api/chat with agent context)
  ├── runner <iframe sandbox="allow-scripts"> (usercontent origin)
  │     └── executes user tool JS, host API bridged via postMessage
  └── requests
        ├── POST /api/agents/:id/chat      (new, reuses startTurn)
        └── POST /api/fetch-proxy          (new, SSRF-guarded page fetch)
```

## Data model

Mirrors the artifact tables: an anchor row plus immutable versions, with a
pinned shared version so the owner can keep editing a draft.

```
agents
  id            text pk ("agent_" + nanoid)
  club_id       -> clubs.id
  owner_id      -> users.id
  name          text (1..80 chars)
  description   text (0..280 chars)
  visibility    'private' | 'club'        (check constraint)
  latest_version_id -> agent_versions.id
  shared_version_id -> agent_versions.id  (null until first share)
  created_at / updated_at / deleted_at

agent_versions
  id            text pk
  agent_id      -> agents.id (cascade delete)
  created_by    -> users.id
  definition    text (JSON, validated server-side, max 64KB)
  created_at
```

The definition is one JSON blob per version, validated by a parser in
`app/lib/agents/contracts.ts` (same style as `app/lib/artifacts/contracts.ts`):

```jsonc
{
  "version": 1,
  "systemPrompt": "...",            // <= 8,000 chars
  "tools": [                        // <= 8 tools
    {
      "name": "extract_text",       // ^[a-z][a-z0-9_]{1,39}$, unique
      "description": "...",         // <= 400 chars
      "parameters": { /* JSON schema object, depth <= 3 */ },
      "source": "..."               // JS, <= 16,000 chars
    }
  ],
  "skills": [                       // <= 8 skills
    { "name": "...", "description": "...", "content": "..." }  // content <= 4,000 chars
  ],
  "builtins": { "fetchPage": true, "memory": true }
}
```

Rejected alternative: normalized `agent_tools` rows. The blob keeps versioning
atomic (a shared version is one immutable snapshot) and the caps keep it
small. Individual-tool reuse across agents is future work.

## Agent definition semantics

- **System prompt:** used verbatim, wrapped by a short server-controlled
  frame (below). No template placeholders in v1.
- **Tools:** user-authored JS, executed in the browser sandbox (next
  section). Each tool is offered to the model as a standard function
  definition via the existing `ToolSpec` -> `openAiToolDefinitions` path.
- **Skills:** named prompt snippets. The system prompt lists skill names and
  descriptions; a built-in `use_skill(name)` tool returns the snippet content
  as the tool result. This mirrors the Gardener's `read_module` pattern and
  teaches progressive disclosure: the agent pulls in instructions when it
  decides it needs them.
- **Builtins:**
  - `fetch_page(url)`: delegated to the browser, which calls the server
    fetch proxy. Full body shown in the trace; capped envelope to the model.
  - `remember(key, value)` / `recall()`: delegated; the executor reads and
    writes IndexedDB namespaced by `(agentId, userId)`. `recall` returns up
    to 20 entries, values capped at 500 chars. Memory belongs to the runner,
    not the agent definition: sharing an agent never shares memories.

### Server-controlled prompt frame

The model request is assembled server-side as:

```
[server frame: "You are an agent built by a member of <club>. Follow the
builder's instructions below. Tools are described separately." + safety
boilerplate + skills index + tool guidance via composeToolsPrompt]

[builder's systemPrompt verbatim]
```

The workbench shows the fully assembled prompt in a "what the model sees"
panel, frame included. Nothing is hidden; that is the point.

## Execution flow

New endpoint `app/routes/api.agents.$agentId.chat.ts`, shaped like
`api.chat.ts` but simpler:

1. Auth: `requireUser` + `requireClubContext`; the agent must belong to the
   club and be visible to the caller (owner, or `visibility='club'`).
2. Body carries the message history (browser-held), the `versionId` being
   run, and optionally a continuation envelope.
3. The server loads and validates that version's definition, builds
   `ToolSpec`s:
   - every user tool: `delegate` returns `{ name, args }` (payload only;
     the browser already holds the source for that version and must execute
     what it holds, keyed by version id),
   - `fetch_page`: `delegate` validates the URL shape (reuse the
     `parseAttachRequest` pattern),
   - `use_skill`: plain server-side `execute` returning the snippet,
   - `remember`/`recall`: delegated.
4. `startTurn` streams; `delegated-call` events serialize to a new marker
   pair (below) and end the turn; the browser fulfills the call and posts a
   continuation, exactly like `query_data` today.
5. Model and credential resolution reuse `resolveClubModel` and
   `getClubChatCredential` unchanged. `maxToolRounds` stays 3 per turn;
   continuations are capped client-side by the existing `MAX_CONTINUATIONS`
   convention.

Test conversations are browser-held only in v1 (no `chatThreads` rows). A
page reload clears the chat; the definition is what persists. This keeps the
endpoint stateless and sidesteps persisting large trace payloads.

### New markers (in `agent-web`)

```
[[tool:call:<urlencoded {version:1, tool, args}>]]
[[tool:callresult:<urlencoded CallResultEnvelope>]]
```

```ts
type CallResultEnvelope =
  | { status: "ok"; resultText: string;        // capped at 4,000 chars
      totalChars: number; truncated: boolean }
  | { status: "error"; error: string };        // capped at 1,000 chars
```

The envelope is what the model sees (re-capped server-side on the
continuation, client is untrusted, same as `parseEnvelope` today). The full
raw result stays in browser memory for the trace's "raw" view and is never
sent to the server. `toModelText` compacts call/callresult pairs to
one-liners for history, mirroring the query compaction.

## The sandbox runner

A static page served by the renderer worker on the usercontent origin
(alongside the pinned DuckDB runtime assets), embedded in the workbench as
`<iframe sandbox="allow-scripts">` so it gets an opaque origin: no cookies,
no storage, no reach into the parent.

- **CSP on the runner page:** `default-src 'none'; script-src` for its own
  bundle plus `'unsafe-eval'` (needed to compile user source via
  `new Function`). Critically `connect-src 'none'`: user code cannot fetch
  directly. Every capability flows through the host API, so a tool's powers
  are exactly what its declared environment provides. That is both the
  security model and the lesson.
- **Protocol:** parent posts `{ id, source, args, timeoutMs }`; runner
  compiles `source` as `async (args, env) => ...` (the editor shows this
  signature), runs it, posts back `{ id, ok, value }` or `{ id, ok: false,
  error }`. Return values must be JSON-serializable; the parent stringifies
  and caps.
- **Host API (`env`), bridged via postMessage to the parent:**
  - `env.fetchPage(url)`: parent calls `POST /api/fetch-proxy` with
    credentials and returns `{ status, contentType, body, totalChars,
    truncated }`.
  - `env.memory.get(key)` / `env.memory.set(key, value)` /
    `env.memory.list()`: parent-side IndexedDB.
  - `env.log(message)`: appends to the trace's console panel for the running
    tool (capped lines), so people can printf-debug their tools.
- **Timeout and runaway code:** the parent enforces `timeoutMs` (10s) by
  discarding and recreating the iframe; a busy-loop cannot wedge the app.
  One call in flight at a time.
- **Trust:** running a shared agent runs its author's JS in your runner.
  The opaque origin plus `connect-src 'none'` means the blast radius is the
  bridged host API, which is rate-limited and namespaced per user. This is
  the same standing decision as gallery artifacts; the runbook's security
  gate applies to any change of these attributes.

## The fetch proxy

`app/routes/api.fetch-proxy.ts`, POST `{ url }`, authenticated club member.

Guards, all server-side:

- `https:` only; hostname must not be an IP literal, `localhost`, `*.local`,
  `*.internal`, or any `*.vibegarden.club` host.
- Response read capped at 1MB (streamed, then aborted); timeout 10s;
  redirects followed at most 3 times with the same hostname checks per hop.
- Text-ish content types only (`text/*`, `application/json`,
  `application/xml`, `+json`/`+xml` suffixes); others return a typed error.
- Rate limit per user (e.g. 30 requests/min) with a clear error the trace
  can display.
- Returns `{ status, contentType, body, totalChars, truncated }` as text.

The proxy returns up to the full 1MB body to the browser (trace shows it
all, virtualized); only the 4,000-char envelope goes to the model. The trace
labels both numbers ("212,340 chars fetched, the model saw 4,000"), which is
the teaching moment in one line of UI.

## Workbench UI

Routes, following existing conventions:

- `/garden/agents`: list (mine + shared in club), create.
- `/garden/agents/$id`: the workbench. Two panes:
  - **Left, definition:** name/description; system prompt editor; tools list;
    skills list; builtin toggles; "what the model sees" assembled-prompt
    preview; save (creates a version), share/unshare, remix source shown when
    the agent was remixed.

    Tool authoring is Gardener-first: the expected path is asking the
    sidekick, reviewing its `propose_tool` card, and applying it. Opening a
    tool card shows the tool as **editable YAML** (name, description,
    parameters, and the JS source as a block scalar) so people can make
    their own adjustments in text rather than through form fields. YAML is
    the editing surface only: it parses client-side (the `yaml` package) to
    the canonical definition JSON, which remains what is validated and
    stored. Parse errors and contract violations render inline before save.
  - **Right, test chat with trace:** the chat stream rendered from marker
    segments. Each `call` segment renders a tool-call card (tool name, args
    pretty-printed). Each `callresult` renders a result card with two tabs:
    **Raw** (full browser-held payload, virtualized scroll, char count) and
    **Sent to model** (the exact envelope). `env.log` lines render in a
    console strip on the card. Errors render as repairable errors, matching
    the existing "Error: ..." philosophy.
- `/garden/agents/$id/run`: try-it view for shared agents: read-only
  definition summary (expandable to full source, transparency again) plus
  the same chat/trace, running the pinned `shared_version_id`. "Remix"
  copies that version's definition into a new agent owned by the caller
  (with a `remixedFrom` note in the definition metadata).

Design language: existing Tufte-ish tokens, no new chrome. The trace cards
reuse the tool-note bubble styling; over ~7 tools the list categorizes, per
the house rule.

## Gardener as sidekick

A Gardener panel in the workbench, using the existing `/api/chat` endpoint
with two additions:

The Gardener is the primary tool-authoring path; the YAML editor exists for
people to adjust what the Gardener produced (or to write a tool by hand once
they outgrow the assistant).

1. The current agent definition rides along as a `WireContextItem` (typed
   `agent-definition`), so "why does my tool return undefined" has context.
2. One new Gardener tool, `propose_tool`, offered only when the request
   carries agent context: arguments `{ name, description, parameters,
   source, rationale }`. It is a delegated tool whose payload the workbench
   renders as an "Add this tool" card with the full source visible; the
   person reviews and clicks apply (which stages it into the editor, not
   straight into a saved version). The Gardener never mutates an agent
   directly; the human stays the builder.

The Gardener's system prompt gains a short section (via the existing
placeholder mechanism in `content/gardener/system-prompt.md`) about helping
people write small, readable tools and explaining raw-result anatomy.

## Sharing and permissions

- `visibility='club'` publishes `shared_version_id` (owner picks "share
  current version"); the owner's later edits create new versions without
  changing what others run, until they re-share. Same shape as
  `galleryVersionId`.
- Owners (and club admins) can unshare or delete. Deletes are soft
  (`deleted_at`), matching artifacts.
- Try-it runs bill the runner's own club credential path and count against
  the runner's rate limits, not the author's.
- Remix requires the agent to be shared; it copies the definition JSON, so
  later edits by either party are independent.

## Error handling

- Invalid definition on save: 400 with field-level messages from the
  contracts parser; the editor highlights.
- Tool runtime error / timeout: error envelope to the model (so it can
  adapt), full error + stack in the trace's raw tab.
- Fetch proxy refusals (blocked host, too large, rate limit): typed error
  envelope with a human-readable reason; the trace shows it verbatim, which
  teaches the boundary exists.
- Model/credential failures: same paths as `api.chat.ts` (502 / 503 JSON
  before the stream starts).
- A stale runner (definition edited mid-conversation): calls are keyed by
  `versionId`; if the browser's loaded version differs, it re-fetches that
  version's definition before executing.

## Testing

- **Contracts:** definition validation, caps, tool-name rules; call/callresult
  marker round-trips and `toModelText` compaction (vitest, `agent-web` and
  `app/lib/agents`).
- **Fetch proxy:** SSRF matrix (IP literals, localhost, redirect hops,
  oversize body, wrong content type, rate limit) in `npm run test:worker`.
- **Runner boundary:** extend `npm run test:security` with a fixture tool
  that attempts direct `fetch`, `parent` access, and cookie reads, asserting
  all fail; assert the runner page's CSP and the iframe sandbox attributes,
  same treatment as `test/security/fixtures/forbidden.html`.
- **Turn flow:** endpoint tests for delegation round-trips with a fake
  upstream (the `agent-core` test harness already fakes SSE).
- **UI:** component tests for trace rendering from marker text.

## Build order

Each stage lands independently and is demoable:

1. **Schema + CRUD + prompt-only agents.** Tables, contracts, list/workbench
   routes, chat endpoint with no tools. You can build and talk to a persona.
2. **fetch_page + trace view.** Fetch proxy, delegation round-trip, raw vs
   sent-to-model tabs. The "HTML soup" lesson works end to end.
3. **Sandbox runner + user JS tools + memory.** Renderer-origin runner page,
   postMessage bridge, tool editor. The full build-your-own-tool loop.
4. **Skills + Gardener propose_tool.** `use_skill` builtin, sidekick panel,
   agent-definition context item.
5. **Sharing.** Visibility, pinned versions, try-it route, remix.

## Resolved decisions

- **Naming:** "Agent Workbench" (route stays `/garden/agents`; the page
  titles and navigation say Agent Workbench).
- **Tool authoring:** Gardener-first via `propose_tool`; manual adjustments
  happen in a per-tool YAML editor (no form builder). Canonical storage
  stays JSON.

## Open questions

- Whether stage 2's fetch proxy should also serve the Gardener's own
  toolset later (out of scope here, but the guards were written to be
  reusable).
