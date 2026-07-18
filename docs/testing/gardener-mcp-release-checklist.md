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

| Host | Scenario | Expected | Status | Redacted request ID / note |
| --- | --- | --- | --- | --- |
| Claude | Connection, DCR, S256 PKCE, requested scopes | Connects to staging `/mcp` and completes OAuth. | `PENDING` | `PENDING` |
| Claude | Projects and conversations | List/detail and pagination expose reviewer A data only. | `PENDING` | `PENDING` |
| Claude | Learning, resources, prompt | Content/resource reads work; `continue_project` is explicit only. | `PENDING` | `PENDING` |
| Claude | Refresh, revocation, reconnect | Refresh works; revoked access fails; reconnect re-requests scopes. | `PENDING` | `PENDING` |
| Claude | Reviewer A domain IDs for reviewer B | `get_project`, `get_conversation`, and project conversation access return `not_found`. | **PENDING — RELEASE-BLOCKING** | `PENDING` |
| Claude | Reviewer A `fetch`/resource IDs for reviewer B | Private `fetch` and `vibegarden://project`/`conversation` reads return `not_found`. | **PENDING — RELEASE-BLOCKING** | `PENDING` |
| Claude | Reviewer A searches reviewer B private text | Normal `{ "results": [] }`; no private title/body. | **PENDING — RELEASE-BLOCKING** | `PENDING` |

## ChatGPT developer-mode app (staging)

In ChatGPT developer mode, add the same staging `/mcp` URL and repeat the
seeded-account scenarios. Confirm `search` and `fetch` are accepted as
company-knowledge shapes, citations use canonical Vibe Garden HTTPS URLs,
and linking UI appears from resource/security metadata plus the runtime OAuth
challenge. Confirm that no MCP App component is requested or rendered.

Revocation must remove access. Re-linking must request both scopes again.
Then repeat the reviewer A versus reviewer B attempts described above.

| Host | Scenario | Expected | Status | Redacted request ID / note |
| --- | --- | --- | --- | --- |
| ChatGPT | Connection and OAuth | Developer-mode connection to staging `/mcp` completes DCR, S256 PKCE, and both scopes. | `PENDING` | `PENDING` |
| ChatGPT | Projects, conversations, learning, resources, prompt | Seeded reviewer scenarios work and remain read-only. | `PENDING` | `PENDING` |
| ChatGPT | Company knowledge and citations | `search`/`fetch` are accepted; citations use canonical Vibe Garden HTTPS URLs. | `PENDING` | `PENDING` |
| ChatGPT | Linking and UI | Linking UI follows resource/security metadata plus runtime challenge; no MCP App component is requested or rendered. | `PENDING` | `PENDING` |
| ChatGPT | Refresh, revocation, re-link | Access refreshes; revocation removes it; re-link requests both scopes. | `PENDING` | `PENDING` |
| ChatGPT | Reviewer A domain IDs for reviewer B | Domain tool attempts return `not_found` with no title, count, timing distinction, or body. | **PENDING — RELEASE-BLOCKING** | `PENDING` |
| ChatGPT | Reviewer A `fetch`/resource IDs for reviewer B | Private `fetch` and resource attempts return `not_found` without disclosure. | **PENDING — RELEASE-BLOCKING** | `PENDING` |
| ChatGPT | Reviewer A searches reviewer B private text | Normal `{ "results": [] }`; no private title/body. | **PENDING — RELEASE-BLOCKING** | `PENDING` |

## Evidence rules

For each host, record the test date, candidate SHA, connector URL, reviewer
fixture version, pass/fail per tool, and redacted request IDs for failures.
Never paste tokens, email addresses, project bodies, or conversation bodies.
Mark a row PASS only with evidence from the corresponding host account; do not
promote local or Inspector evidence to a host PASS.
