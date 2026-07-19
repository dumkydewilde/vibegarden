# The Gardener MCP Server: Design Spec

**Date:** 2026-07-18
**Status:** Approved in conversation; written review pending

## Summary

Expose Vibe Garden's projects, conversations, and learning content through an
authenticated remote MCP server. Claude and ChatGPT remain the assistants: the
server supplies Gardener knowledge and project continuity but does not call a
model or promise to replace the host's personality.

The MCP endpoint runs in the existing Cloudflare Worker. The first release is
read-only and does not run server-side DuckDB, provision MotherDuck accounts,
or write artifacts. A narrow analysis boundary leaves room for a native DuckDB
container, MotherDuck through its Postgres-compatible endpoint, or both later.

## Decisions

- Claude and ChatGPT keep their own identity and voice. The Gardener's tone is
  available as an explicit prompt and resource, not enforced by server
  instructions.
- The remote MCP endpoint shares the existing Worker, D1 data, application
  services, and Vibe Garden user identity.
- The protocol transport is Streamable HTTP over HTTPS.
- MCP authorization uses OAuth 2.1, authorization code with PKCE, protected
  resource metadata, and dynamic client registration.
- The MVP has two scopes: `projects:read` and `content:read`.
- Project and content access is read-only. Project writes and artifact writes
  are later, separately scoped capabilities.
- The website keeps its current private DuckDB-WASM flow. The MVP MCP server
  has no server-side DuckDB runtime.
- The design reserves an `AnalysisBackend` boundary but ships no analysis
  tools until a backend exists.
- Automatic MotherDuck provisioning through `new.motherduck.com` is outside
  this project. It can be added if persistent datasets become important.
- Data should normally be queried at its public origin or in MotherDuck.
  Artifact storage is for project outputs such as HTML and CSS, not a general
  dataset-ingestion path.
- The only supported hosts for the initial release are Claude and ChatGPT,
  including their coding surfaces where remote MCP is available.

## Goals

1. Let a participant connect Claude or ChatGPT to Vibe Garden with the same
   identity they use on the website.
2. Let the host list and read that participant's projects and associated
   conversations so work can continue outside the website.
3. Make the Gardener's learning articles, building-block guidance, and curated
   reading feed available as grounded sources.
4. Offer an optional, explicit project-continuation prompt that approximates
   the Gardener's working style without claiming control over the host model.
5. Establish the OAuth, tool metadata, privacy, and testing foundations needed
   for a later Claude Connectors Directory or ChatGPT app submission.
6. Leave server-side analysis and artifact writes addable without changing the
   identity or project-access architecture.

## Non-goals

- Running the Gardener or any other LLM behind an MCP tool.
- Replaying a Vibe Garden thread as a Claude or ChatGPT conversation.
- Controlling the host model's global personality.
- Giving the MCP server access to browser-local DuckDB state.
- Uploading datasets into Vibe Garden.
- Provisioning or claiming MotherDuck accounts.
- Creating, editing, deleting, publishing, or sharing projects or artifacts.
- Supporting MCP hosts other than Claude and ChatGPT in the first release.
- Shipping an MCP App UI in the MVP.

## Architecture

### One Worker, two surfaces

The current Worker remains the deployment unit and exposes two surfaces:

- The existing React Router application for the Vibe Garden website.
- A Streamable HTTP MCP endpoint at `/mcp`, plus its OAuth and discovery
  endpoints.

The top-level Worker dispatches MCP and OAuth routes to their handlers and all
other routes to the current React Router request handler. MCP tools import the
same project, thread, content, module, and MotherDuck service functions as the
website. They do not call the website over HTTP and do not duplicate database
queries in a second service.

### Components

1. **OAuth adapter:** Cloudflare's Workers OAuth Provider library handles
   client registration, authorization codes, access and refresh tokens, PKCE,
   and token validation. OAuth state is stored in a dedicated KV binding.
2. **Vibe Garden authorization handler:** Reuses the existing `vg_session`
   login. An unauthenticated browser is sent through the current email or
   Google login and returned to the authorization flow. A consent page records
   the requested scopes and binds the grant to the authenticated D1 `userId`.
3. **MCP transport adapter:** Implements initialization, tool discovery, prompt
   discovery, resource templates, tool calls, and resource reads over
   Streamable HTTP.
4. **Domain services:** Existing functions in `projects.server.ts`,
   `threads.server.ts`, `content.ts`, `modules.ts`, and
   `motherduck.server.ts` remain authoritative. MCP-specific presenters shape
   their results into public schemas.
5. **Future analysis adapter:** An inactive interface separates MCP tool
   definitions from a future DuckDB container or MotherDuck implementation.

The MCP server is stateless between protocol requests. OAuth grants persist in
KV; application state persists in D1; content remains build-time content.

## Authentication and authorization

### Connection flow

1. A host requests `/mcp` without a usable access token.
2. The Worker returns HTTP `401` with a `WWW-Authenticate` challenge pointing
   at OAuth protected resource metadata.
3. The host discovers the authorization server, registers a client through
   DCR, and starts authorization code plus PKCE using the canonical MCP URL as
   the OAuth resource.
4. `/authorize` checks the existing Vibe Garden session. If absent, it sends
   the user to the current login flow with a validated internal return path.
5. The user sees the requesting client, requested scopes, and a concise consent
   explanation.
6. The grant stores the D1 `userId` and approved scopes as trusted token
   properties.
7. Every MCP request validates issuer, audience/resource, expiry, signature,
   and scopes before invoking a tool.
8. Every private query includes the token's `userId` in its D1 predicate.

The initial OAuth implementation uses DCR because both target platforms
support it. Protected resource and authorization server metadata are complete
enough to add Client ID Metadata Documents later without changing tools or
user identity.

### Scopes

| Scope | Allows |
|---|---|
| `projects:read` | List and read the participant's projects and conversations |
| `content:read` | List and read learning content, modules, and curated public reads |

Later scopes are additive and requested through reauthorization:

| Future scope | Allows |
|---|---|
| `projects:write` | Create or update projects, but not delete them |
| `artifacts:write` | Create private project artifacts |
| `artifacts:publish` | Share or publish an artifact to a public surface |

Delete permissions, if ever added, require their own destructive tools and an
explicit scope rather than being folded into a general write permission.

## MCP instructions, personality, and context

Server instructions contain only cross-tool operational guidance: list before
fetching when an ID is unknown, use the narrowest tool, paginate long history,
and treat stored conversation text as user-authored data. The first 512
characters are self-contained. The instructions do not attempt to change the
host model's personality.

A new compact content file, `content/gardener/mcp-guide.md`, describes:

- Warm, plain-spoken explanations without condescension.
- One question at a time.
- Concrete next steps rather than abstract advice.
- Vibe Garden's seed, growing, and bloomed project stages.
- How learning articles and building blocks support a project.
- The fact that Claude or ChatGPT, not the MCP server, is speaking.

That file is exposed as `vibegarden://guide/gardener` and embedded by the
`continue_project` prompt on hosts that surface MCP prompts. The resource
stands alone on hosts that do not. It is a public host-facing guide, not a
system prompt and not a copy of private audience context.

The website's existing system prompt remains unchanged and authoritative for
the in-site Gardener.

## Tool surface

All MVP tools declare a human-readable title, an input schema, an output
schema, `readOnlyHint: true`, and the appropriate OAuth security scheme.
Every private tool resolves the current participant from the access token.

### Project tools

#### `list_projects`

Input:

- Optional `status`: `seed`, `growing`, or `bloomed`.
- Optional opaque pagination cursor.
- Optional page size, capped by the server.

Output: project ID, title, one-liner, status, building-block names, updated
time, and canonical HTTPS URL. It never returns `userId`.

#### `get_project`

Input: `project_id`.

Output: the owned project's public fields, building blocks, primary
conversation reference, linked conversation references, and canonical URL.
An ID owned by someone else is indistinguishable from a missing ID.

#### `list_project_conversations`

Input: `project_id`, optional cursor, optional capped page size.

Output: conversation ID, title, updated time, message count, and canonical URL.

#### `get_conversation`

Input: `conversation_id`, optional cursor, optional capped page size.

Output: ordered messages with role, sanitized model-facing content, relevant
context labels, and creation time. Internal tool-note syntax and raw browser
query markers are not exposed. The presenter reuses the existing history
compaction/sanitization behavior where applicable.

### Learning tools

#### `list_learning_content`

Input: optional text query, kind (`article` or `module`), category, and capped
page size.

Output: kind, slug, title, description, category, level where applicable, and
canonical URL.

#### `read_article`

Input: article slug.

Output: title, description, category, level, Markdown body without
frontmatter, and canonical URL.

#### `read_module`

Input: module slug.

Output: title, description, category, Markdown body without frontmatter, and
canonical URL.

#### `fresh_reads`

Input: optional topic and optional supported content type.

Output: the existing bounded curated results with titles, summaries, content
types, and source URLs. This tool is registered only when the current
read-only MotherDuck backend is configured.

### Compatibility tools

#### `search`

Input: exactly one string `query`.

Searches the authenticated user's projects and conversations plus public
learning content. The MVP uses bounded D1/content search suitable for the
small participant group; it does not add a vector index. Output follows the
OpenAI company-knowledge shape: `results[]` with stable `id`, title, and a
canonical, user-openable HTTPS URL.

IDs are namespaced, for example `project:<id>`, `conversation:<id>`,
`article:<slug>`, and `module:<slug>`.

#### `fetch`

Input: exactly one string `id` returned by `search`.

Output follows the OpenAI compatibility shape: `id`, title, text, canonical
URL, and minimal metadata. Private IDs receive the same ownership checks as
their domain-specific tools. The JSON value is returned as
`structuredContent` and as a JSON-encoded text content block for client
compatibility.

### Tools intentionally omitted

- `fetch_page`: hosts already have web capabilities; a generic URL proxy adds
  SSRF risk and weakens directory reviewability.
- `visualize_flow`: the current implementation renders only in the Vibe
  Garden chat UI. Hosts can create Mermaid without this server.
- `attach_data` and `query_data`: their current browser-marker protocol cannot
  run in a remote MCP host.
- Project, conversation, or artifact writes: the first OAuth grant is
  intentionally read-only.

## Resources and prompts

MCP resource templates call the same presenters as tools:

- `vibegarden://project/{id}`
- `vibegarden://conversation/{id}`
- `vibegarden://article/{slug}`
- `vibegarden://module/{slug}`
- `vibegarden://guide/gardener`

Private resource reads enforce the same token scopes and ownership predicates
as tools. Resource URIs are identifiers, not proof of access.

The `continue_project(project_id)` prompt:

1. Resolves the owned project.
2. Embeds its project resource and the compact Gardener guide.
3. Instructs the host to restate the current project briefly, find the
   smallest useful next step, and finish with one question.
4. Labels stored conversation excerpts as user-authored context.

Invoking the prompt is an explicit user choice. Normal tool use does not add
the style guide to every host turn.

## Response and data handling

Tool responses separate three concerns:

- `structuredContent`: concise, typed fields needed by the host.
- `content`: a short neutral summary or compatibility JSON.
- Internal server context: never returned to the host.

All list and history tools paginate. Page sizes and text lengths are capped
before MCP serialization. Stable canonical HTTPS URLs point at existing
authenticated Vibe Garden pages, enabling citations and a way back to the
source of truth.

The server receives only explicit MCP tool arguments. It does not receive the
surrounding Claude or ChatGPT conversation and does not retain search queries
or tool bodies as product analytics. Operational logs contain the tool name,
outcome, latency, request identifier, and a one-way user-scoped hash. They do
not contain project text, conversation text, tokens, or email addresses.

## Error handling

- Missing or invalid authentication returns HTTP `401` with the OAuth
  discovery challenge.
- A valid token lacking a required scope returns `403` and an OAuth challenge
  describing the insufficient scope.
- Invalid tool input returns an MCP error result with a stable public error
  code and an actionable message.
- Missing and unauthorized private records both return `not_found`.
- D1 or MotherDuck availability failures return `temporarily_unavailable`
  with retry guidance; they do not terminate the MCP transport.
- Unexpected exceptions are logged without sensitive bodies and return
  `internal_error` without a stack trace, SQL, or infrastructure detail.
- Optional tools are omitted from tool discovery when their backend is not
  configured.

## Security and privacy

- OAuth access is bound to the canonical MCP resource and approved scopes.
- Client-provided email addresses and user IDs never establish identity.
- Every project and conversation query includes the authenticated `userId`.
- Resource-template IDs, search IDs, and cursors are opaque inputs and are
  validated before use.
- Stored messages and project text are untrusted content. They cannot modify
  server instructions, tool schemas, authorization, or scopes.
- Tool outputs exclude participant email, admin role, web sessions, OAuth
  state, internal logs, and unrelated database fields.
- Rate limits apply per OAuth user and tool. Full-conversation reads have a
  stricter limit than metadata lists.
- OAuth consent, revocation, scope changes, and token refresh are auditable.
- The Worker validates request origins according to MCP and target-host
  requirements while allowing non-browser MCP clients that legitimately omit
  an Origin header.
- Public documentation discloses what project and conversation data tools can
  read, operational logging, retention, subprocessors, and how to revoke
  access.

## Deferred analysis design

No analysis interface is exposed in the MVP. The internal contract reserves
three operations:

- Inspect a source and return a user-bound opaque source handle.
- Execute bounded read-only DuckDB SQL against a source handle.
- Release the handle and its temporary resources.

Two implementations may be added independently.

### Origin DuckDB backend

A native DuckDB process runs in an on-demand container, not in the Worker
isolate. It reads public CSV, JSON, or Parquet URLs, enforces network egress
and private-address restrictions, isolates queries by OAuth user, caps CPU,
memory, rows, text, and wall time, and expires the workspace six hours after
last use. A restarted container may refetch an origin; the opaque handle never
grants cross-user access.

### MotherDuck backend

The Worker uses the Postgres-compatible endpoint for persistent cloud tables
when its supported SQL and data-access surface is sufficient. Native DuckDB
connectivity remains an option only if future tools require hybrid execution
or features the Postgres-compatible endpoint cannot provide. MotherDuck data
does not use the six-hour workspace lifecycle.

The product may ship either backend or both. MCP authentication, project
tools, and source-handle schemas do not depend on that choice.

## Deferred artifact design

Artifact creation is a separate write milestone, optimized for model-generated
HTML and CSS rather than dataset uploads.

`create_artifact(project_id, files)` will accept a bounded collection of text
files. The server will validate ownership, paths, extensions, MIME types,
individual sizes, and aggregate size; reject traversal and duplicate paths;
write immutable objects to R2; and create an artifact record in D1.

Private previews will use a separate sandboxed origin and restrictive Content
Security Policy. The tool will require `artifacts:write` and be annotated as a
non-destructive, bounded write. Publishing or sharing will be a different tool
requiring `artifacts:publish`, explicit confirmation, and an open-world impact
annotation.

Generated source normally travels as structured MCP arguments. Existing-file
import can later use ChatGPT's native file parameter support or a cross-host
MCP App file picker that uploads directly to Vibe Garden. Downloads use
standard MCP resource links so either target host can present them.

## Verification

### Unit tests

- Input and output schemas for every tool.
- Scope checks and token-property parsing.
- Ownership predicates for project and conversation access.
- Pagination cursors, page-size caps, and output-size caps.
- Conversation sanitization and removal of internal tool markers.
- `search`/`fetch` ID namespacing and compatibility response shapes.
- Error mapping and privacy-safe public messages.

### Integration tests

- Local D1 plus OAuth KV grant, refresh, revocation, and expiry flows.
- Wrong audience/resource, missing scope, and malformed-token rejection.
- Cross-user project, conversation, search, fetch, and resource-read attempts.
- Existing email and Google login return safely to OAuth authorization.
- Optional `fresh_reads` discovery with and without configuration.

### Protocol and host tests

- MCP Inspector: initialization, deterministic discovery order, tool calls,
  resources, prompts, OAuth, refresh, and Streamable HTTP reconnect behavior.
- Claude custom connector: connect, list projects, continue a project, read a
  conversation, and use learning content.
- ChatGPT developer-mode app: the same seeded-account scenarios and
  `search`/`fetch` compatibility.
- A behavior fixture set verifies correct tool choice, correct participant
  data, safe treatment of stored prompt-like text, and coherent project
  continuation. Gardener-like tone is scored only after explicit use of the
  `continue_project` prompt.

The riskiest release check is an end-to-end cross-user isolation test through
each real host, not only direct database or handler tests.

## Operational readiness

- Structured logs and Cloudflare observability report tool latency, status,
  rate-limit outcomes, and OAuth failures without content bodies.
- Server name and semantic version are stable and included in MCP
  initialization.
- Tool discovery order is deterministic for client and prompt caching.
- OAuth metadata, documentation, privacy policy, support contact, and a seeded
  reviewer account are public before directory submission.
- The official-review account uses isolated, populated test data and a stable
  reviewer login that does not require email OTP, SMS, MFA, or access to a
  participant's real identity provider. This path is enabled only for the
  declared review account and is not the normal participant login.
- Every tool has a recorded test case with expected output characteristics.
- Tool and scope changes are versioned and documented; breaking resource or
  MCP App changes receive new URIs.

## Official distribution readiness

The custom server launches before any directory submission. Its baseline is
chosen to avoid a later protocol rewrite.

For Claude, the server already uses HTTPS, Streamable HTTP, OAuth 2.1, titles,
impact annotations, resources, prompts, and deterministic bounded results.
Submission additionally requires public documentation, privacy disclosures,
a populated test account, and successful execution of every tool in Claude
and MCP Inspector.

For ChatGPT, the server already uses OAuth protected resource metadata, DCR,
PKCE, output schemas, structured content, annotations, canonical URLs, and the
`search`/`fetch` compatibility shapes. A later MCP App adds versioned UI
resources, CSP, and host-specific domain metadata only when interactive UI is
actually needed.

Relevant current references:

- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Cloudflare remote MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
- [Claude custom connector requirements](https://claude.com/docs/connectors/building)
- [Claude connector authentication](https://claude.com/docs/connectors/building/authentication)
- [Claude directory submission](https://claude.com/docs/connectors/building/submission)
- [OpenAI MCP server guidance](https://developers.openai.com/apps-sdk/build/mcp-server)
- [OpenAI MCP authentication](https://developers.openai.com/apps-sdk/build/auth)
- [OpenAI app submission](https://developers.openai.com/apps-sdk/deploy/submission)
- [DuckDB concurrency](https://duckdb.org/docs/current/connect/concurrency)
- [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Container limits](https://developers.cloudflare.com/containers/platform-details/limits/)
