# Gardener MCP release checklist

Use this checklist for a release candidate only. The local protocol pass is
necessary but cannot replace the two real-host isolation checks. Do not record
tokens, email addresses, project bodies, conversation bodies, or unredacted
request IDs in this file.

## Release gate

- [ ] Local checks pass for the candidate SHA.
- [ ] MCP Inspector check passes against the local Worker.
- [ ] Claude custom connector check passes against the HTTPS staging endpoint.
- [ ] ChatGPT developer-mode check passes against the same HTTPS staging endpoint.
- [ ] Claude reviewer-A versus reviewer-B isolation is **PASS**.
- [ ] ChatGPT reviewer-A versus reviewer-B isolation is **PASS**.

Launch is blocked until both real-host isolation rows are PASS. A local Worker
test is supporting evidence, not a substitute for either host check.

## Candidate details

| Field | Value |
| --- | --- |
| Test date (UTC) | `PENDING` |
| Tested build SHA | `PENDING` |
| Reviewer fixture version | `PENDING` |
| Staging connector URL | `PENDING` |
| Observed server version | `PENDING` |
| Observed MCP protocol version | `PENDING` |

## Local automated and Inspector protocol

Run the candidate from a clean checkout:

```bash
npm run test:all
npm run typecheck
npm run build
npm run dev
npm run mcp:inspect
```

In MCP Inspector's connection pane, select **Streamable HTTP** and enter
`http://localhost:5173/mcp`. Record the server and protocol versions in the
Candidate details table. Use an Inspector-supported local OAuth flow; do not
copy tokens into this checklist.

| Check | Expected result | Status / redacted evidence |
| --- | --- | --- |
| Initialize metadata | Server is `vibe-garden` version `1.0.0`; instructions are operational and do not set host personality. | `PENDING` |
| Ordered discovery | `list_projects`, `get_project`, `list_project_conversations`, `get_conversation`, `list_learning_content`, `read_article`, `read_module`, optional `fresh_reads`, `search`, `fetch`. | `PENDING` |
| DCR and S256 PKCE | Dynamic registration, protected-resource discovery, authorization code, S256 PKCE, and exact `/mcp` resource binding complete. | `PENDING` |
| Scopes | `projects:read` and `content:read` appear in consent and discovery metadata; insufficient scope returns its OAuth challenge before execution. | `PENDING` |
| Every tool | Exercise each discovered tool with valid input and confirm read-only schemas/metadata. | `PENDING` |
| Optional MotherDuck | Without a token, `fresh_reads` is absent from discovery; with a configured read-only backend, it returns bounded results. | `PENDING` |
| Pagination and invalid cursor | Project, project-conversation, conversation, and learning lists paginate; malformed/expired/wrong-kind cursors return `invalid_cursor`. | `PENDING` |
| Resources | Read project, conversation, article, module, and `vibegarden://guide/gardener`; check scope and ownership enforcement. | `PENDING` |
| Prompt | `continue_project` only on explicit invocation; it supplies user-authored context, a brief restatement, smallest next step, and one question. | `PENDING` |
| Refresh and reconnect | Refresh rotates; expired tokens fail; revocation removes access and reconnect requests authorization again. | `PENDING` |
| No optional analysis | `fresh_reads` is absent without a token; no analysis, artifact, or write tool is exposed. | `PENDING` |

## Claude custom connector (staging)

Deploy a staging custom domain with HTTPS and production-equivalent OAuth
bindings. In **Claude Settings > Connectors**, add the exact staging `/mcp`
URL. Sign in as the seeded reviewer account and verify connection, project
list/detail, conversation pagination, learning content, resource reads, the
explicit `continue_project` prompt, refresh after token expiry, and
revocation/reconnect.

Copy reviewer B's known project and conversation IDs from the D1 fixture while
signed in as reviewer A. Through Claude, attempt each private ID via the
domain tools, `fetch`, and resources. Domain and resource reads and `fetch`
must return `not_found` without title, message count, timing distinction, or
body. A cross-user `search` must return normal `{ "results": [] }` and reveal
no private title or body.

Every row below is a separate staging evidence item. Keep its status
**PENDING — RELEASE-BLOCKING** until it has a redacted Claude request ID or
equivalent host-visible evidence. `fresh_reads` has two mutually exclusive
rows: execute the configured row only when the staging environment has the
read-only MotherDuck token; otherwise execute the unavailable row.

| Host | Surface / case | Expected | Status | Redacted request ID / note |
| --- | --- | --- | --- | --- |
| Claude | Initialize and tool discovery | Initialize identifies `vibe-garden`; discovery is ordered and read-only. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `list_projects` | Reviewer A receives only their projects; valid cursor paginates. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `get_project` | Reviewer A can read an owned project only. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `list_project_conversations` | Reviewer A can paginate conversations for an owned project only. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `get_conversation` | Reviewer A receives ordered, bounded pages for an owned conversation only. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `list_learning_content` | Published content and valid pagination are returned. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `read_article` | A published article is returned with its canonical HTTPS URL. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `read_module` | A published module is returned with its canonical HTTPS URL. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `fresh_reads` when configured | With the read-only MotherDuck token, bounded results and source URLs are returned. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `fresh_reads` when unavailable | Without the token, `fresh_reads` is absent from `tools/list`; no backend error is exposed. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `search` | Company-knowledge result IDs and canonical HTTPS citations are returned without private data. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `fetch` | A namespaced public-content ID resolves to a canonical HTTPS citation. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `resources/templates/list` | Project, conversation, article, and module URI templates are discovered. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `resources/read` project | An owned `vibegarden://project/{id}` resource is readable. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `resources/read` conversation | An owned `vibegarden://conversation/{id}` resource is readable. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `resources/read` article | A published `vibegarden://article/{slug}` resource is readable. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `resources/read` module | A published `vibegarden://module/{slug}` resource is readable. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `resources/read` gardener guide | `vibegarden://guide/gardener` is readable with content scope. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | `continue_project` | Only explicit invocation returns user-authored context, a brief restatement, smallest next step, and one question. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Missing and malformed Bearer credentials | Exact `/mcp` requests return 401 with the protected-resource `WWW-Authenticate` challenge and no validation detail. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Exact endpoint routing | `/mcp` alone is protected; `/mcp/...`, `/mcp-not-an-endpoint`, and unrelated website routes do not receive an MCP challenge. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Protected-resource metadata, DCR, S256 PKCE, resource binding | Metadata names exact staging `/mcp`; registration and OAuth succeed only with approved redirect URI, S256, and resource. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Scope challenge and invalid input/cursor | Insufficient scope challenges before execution; invalid input and malformed/expired/wrong-kind cursors are stable public errors. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Origin and read-only discovery boundaries | Disallowed browser origins are rejected; origin-less clients work; no write, analysis, or artifact tool appears. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Refresh, expiry, revocation, reconnect | Refresh rotates; expiry/revocation return 401; reconnect requests scopes again. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Rate limiting | General and history limits return the stable public rate-limit error without private data. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Cross-user `get_project` | Reviewer B's project ID returns `not_found`; no title, body, count, or timing distinction. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Cross-user `get_conversation` and `list_project_conversations` | Reviewer B's IDs return `not_found`; no title, body, count, or timing distinction. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Cross-user `fetch` project and conversation IDs | Reviewer B's namespaced IDs return `not_found` without disclosure. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Cross-user project and conversation resource reads | Reviewer B's resource URIs return `not_found` without disclosure. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| Claude | Cross-user `search` | Reviewer B's private text yields normal `{ "results": [] }` and no private title or body. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |

## ChatGPT developer-mode app (staging)

In ChatGPT developer mode, add the same staging `/mcp` URL and repeat the
seeded-account scenarios. Confirm `search` and `fetch` are accepted as
company-knowledge shapes, citations use canonical Vibe Garden HTTPS URLs,
and linking UI appears from resource/security metadata plus the runtime OAuth
challenge. Confirm that no MCP App component is requested or rendered.

Revocation must remove access. Re-linking must request both scopes again.
Then repeat the reviewer A versus reviewer B attempts described above.

Every row below is a separate staging evidence item. Keep its status
**PENDING — RELEASE-BLOCKING** until it has a redacted ChatGPT request ID or
equivalent host-visible evidence. `fresh_reads` has two mutually exclusive
rows: execute the configured row only when the staging environment has the
read-only MotherDuck token; otherwise execute the unavailable row.

| Host | Surface / case | Expected | Status | Redacted request ID / note |
| --- | --- | --- | --- | --- |
| ChatGPT | Initialize and tool discovery | Initialize identifies `vibe-garden`; discovery is ordered and read-only. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `list_projects` | Reviewer A receives only their projects; valid cursor paginates. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `get_project` | Reviewer A can read an owned project only. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `list_project_conversations` | Reviewer A can paginate conversations for an owned project only. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `get_conversation` | Reviewer A receives ordered, bounded pages for an owned conversation only. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `list_learning_content` | Published content and valid pagination are returned. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `read_article` | A published article is returned with its canonical HTTPS URL. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `read_module` | A published module is returned with its canonical HTTPS URL. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `fresh_reads` when configured | With the read-only MotherDuck token, bounded results and source URLs are returned. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `fresh_reads` when unavailable | Without the token, `fresh_reads` is absent from `tools/list`; no backend error is exposed. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `search` | Accepted as a company-knowledge shape; result IDs and canonical HTTPS citations contain no private data. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `fetch` | Accepted as a company-knowledge shape; a namespaced public-content ID resolves to a canonical HTTPS citation. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `resources/templates/list` | Project, conversation, article, and module URI templates are discovered. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `resources/read` project | An owned `vibegarden://project/{id}` resource is readable. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `resources/read` conversation | An owned `vibegarden://conversation/{id}` resource is readable. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `resources/read` article | A published `vibegarden://article/{slug}` resource is readable. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `resources/read` module | A published `vibegarden://module/{slug}` resource is readable. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `resources/read` gardener guide | `vibegarden://guide/gardener` is readable with content scope. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | `continue_project` | Only explicit invocation returns user-authored context, a brief restatement, smallest next step, and one question. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Missing and malformed Bearer credentials | Exact `/mcp` requests return 401 with the protected-resource `WWW-Authenticate` challenge and no validation detail. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Exact endpoint routing | `/mcp` alone is protected; `/mcp/...`, `/mcp-not-an-endpoint`, and unrelated website routes do not receive an MCP challenge. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Protected-resource metadata, DCR, S256 PKCE, resource binding | Metadata names exact staging `/mcp`; registration and OAuth succeed only with approved redirect URI, S256, and resource. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Scope challenge and invalid input/cursor | Insufficient scope challenges before execution; invalid input and malformed/expired/wrong-kind cursors are stable public errors. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Origin and read-only discovery boundaries | Disallowed browser origins are rejected; origin-less clients work; no write, analysis, or artifact tool appears. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Linking and UI | Linking UI follows resource/security metadata plus the runtime challenge; no MCP App component is requested or rendered. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Refresh, expiry, revocation, reconnect | Refresh rotates; expiry/revocation return 401; reconnect requests scopes again. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Rate limiting | General and history limits return the stable public rate-limit error without private data. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Cross-user `get_project` | Reviewer B's project ID returns `not_found`; no title, body, count, or timing distinction. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Cross-user `get_conversation` and `list_project_conversations` | Reviewer B's IDs return `not_found`; no title, body, count, or timing distinction. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Cross-user `fetch` project and conversation IDs | Reviewer B's namespaced IDs return `not_found` without disclosure. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Cross-user project and conversation resource reads | Reviewer B's resource URIs return `not_found` without disclosure. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |
| ChatGPT | Cross-user `search` | Reviewer B's private text yields normal `{ "results": [] }` and no private title or body. | **PENDING — RELEASE-BLOCKING** | `PENDING — redacted at collection` |

## Evidence rules

For each host, record the test date, candidate SHA, connector URL, reviewer
fixture version, pass/fail per tool, and redacted request IDs for failures.
Never paste tokens, email addresses, project bodies, or conversation bodies.
Mark a row PASS only with evidence from the corresponding host account; do not
promote local or Inspector evidence to a host PASS.
