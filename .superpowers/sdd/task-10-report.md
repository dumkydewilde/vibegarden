# Task 10 report: Worker Dispatch, OAuth Provider, and Runtime Integration

## Outcome

Implemented the production Worker composition for authenticated MCP while preserving the React Router website surface. The Worker now delegates OAuth metadata, DCR, token issuance, refresh, revocation, protected-resource enforcement, and scheduled OAuth KV cleanup to `@cloudflare/workers-oauth-provider`; authenticated MCP requests use a newly created MCP server for every request.

## RED / GREEN record

- **RED:** Added `test/mcp/worker.test.ts` for unauthenticated `/mcp`, website routing, and OAuth metadata. `npm run test:mcp` failed as expected: the Task 1 fixture returned `404` for `/mcp` and `Not Found` was not metadata JSON.
- **GREEN:** Added the OAuth provider, stateless MCP handler, Router extraction, test fixture authorization handler, and Worker composition. The same suite passed.
- Added real Worker tests for DCR, S256 PKCE code exchange, refresh rotation, revocation, invalid resource/redirect rejection, invalid tool inputs, and HTTP-level insufficient-scope challenges. The only initial transport mismatch was an expected MCP `406` when the test client omitted `Accept: application/json, text/event-stream`; the client helper now sends the required MCP header.

## Security and protocol behavior implemented

- `/mcp` has an unauthenticated `401` challenge with protected-resource metadata; all non-OAuth/non-MCP paths remain React Router paths.
- OAuth configuration advertises exactly `projects:read` and `content:read`, requires S256 PKCE, disables implicit and token-exchange grants, binds resource metadata to `MCP_RESOURCE_URL`, and uses the required production TTLs.
- The production consent route now rejects authorization requests whose RFC 8707 resource is not exactly `MCP_RESOURCE_URL`; missing or multiple resources are rejected as well.
- Dynamic registration permits only the specified Claude, ChatGPT, and ported loopback callback patterns. It rejects empty, credential-bearing, fragmented, and non-HTTP callback sets with `invalid_redirect_uri`.
- `mcpHandler` checks browser origins, creates a fresh `McpServer` per request, and parses only a request clone for preflight validation.
- Invalid tool arguments return HTTP 200 JSON-RPC `invalid_input` without Zod details. Preflight scope failures return HTTP 403, preserve the request ID, and include both `WWW-Authenticate` and the MCP `_meta["mcp/www_authenticate"]` challenge.
- The scheduled handler invokes OAuth KV expiry/orphan cleanup in batches of 100 and logs aggregate checked/purged counts only.

## Changed files

- `workers/react-router.ts` — extracted unchanged React Router request handling.
- `workers/mcp.ts` — origin checks, scope/input preflight, and stateless MCP dispatch.
- `workers/oauth.ts` — OAuthProvider factory, exact metadata/TTLs, DCR redirect validation, safe OAuth logging.
- `workers/app.ts` — production default/OAuth/React Router composition and scheduled cleanup.
- `test/mcp/fixture-worker.ts` — local OAuth authorization and grant-revocation fixture over real provider/MCP code.
- `test/mcp/worker.test.ts` — workerd integration tests through `SELF`.
- `app/routes/oauth.authorize.tsx` and its test — exact OAuth resource validation at consent time.

## Verification

All commands passed:

```text
npm run test:all   # 41 JS test files / 239 tests; 2 Worker test files / 7 tests
npm run typecheck
npm run build
```

## Limitations and self-review

- The available MCP package emits source-map warnings for missing upstream source files in the workerd test run. Tests pass; this is dependency noise, not an application warning.
- The OAuth package reports that Client ID Metadata Documents are disabled because this Worker does not enable `global_fetch_strictly_public`; this is intentional because this integration relies on DCR and does not enable CIMD.
- The integration suite validates the real OAuth lifecycle and HTTP trust boundary. Existing unit suites cover the full MCP server catalog, owned D1 access, resource/prompt behavior, and rate limiter wrappers. This task’s added Worker suite does not seed and repeat every individual data-access/rate-limit case at the HTTP layer.
- Self-review found no change to React Router route behavior, no Durable Object, no server-side DuckDB binding, no external deployment, and no unscoped user data access introduced by this task.

## Review remediation: dispatch and transport boundary

### RED / GREEN record

- **RED:** Added real workerd cases for a disallowed `Origin` on both `OPTIONS /mcp` and `POST /mcp`, and for `/mcp/not-an-mcp-endpoint` plus `/mcp-not-an-endpoint`. `npm run test:mcp -- --reporter=verbose` failed as expected: the OAuth provider returned `204` to the untrusted preflight and `401` to both prefix-only paths.
- **GREEN:** The outer Worker and fixture now reject a disallowed Origin before constructing the OAuth provider and only send the exact configured `/mcp` route plus OAuth discovery/endpoints through that provider. All other paths go to the default website handler. The same real workerd suite passes.
- **RED:** Added a malformed `prompts/get` request. It reached the SDK parser and produced an SSE event instead of the required stable JSON-RPC public error.
- **GREEN:** MCP preflight now strictly parses `continue_project` arguments before transport dispatch and returns `invalid_input` without schema internals.
- **RED:** The installed `agents/mcp` transport catches unexpected errors by logging the raw error object and putting its message in a `500` JSON-RPC response.
- **GREEN:** The Worker wraps that transport, emits only fixed structured fields (`event`, `errorClass`, method, and path), and replaces any transport `500` with the existing generic `internal_error` public result.

### Expanded runtime evidence

- Workerd coverage now asserts malformed tokens, exact metadata scope equality, `resources/templates/list`, `prompts/list`, missing/extra/oversized tool input, disallowed-Origin `OPTIONS` and `POST`, origin-less authenticated calls, exact MCP dispatch, and stable malformed-prompt handling in addition to the already-real DCR/S256, refresh, revocation, resource, and scope-challenge flow.
- `npm run test:all` passed: **41 JS test files / 239 tests; 2 workerd files / 10 tests**.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.

### Compatibility constraint

The installed `@cloudflare/workers-oauth-provider@0.8.2` rejects `accessTokenTTL: 1` at construction with `accessTokenTTL must be an integer of at least 60 seconds (Cloudflare KV's minimum expiration window)`. The optional fixture override remains available, but a one-second real-workerd lifecycle test cannot be run against this package without changing the dependency or its KV minimum-TTL policy. Production retains the required 3,600-second access-token TTL.

## Final coverage repair: real expiry, private D1 non-disclosure, and limits

### Provider compatibility decision

- `@cloudflare/workers-oauth-provider` is now pinned to **0.8.0**. It retains the `clientRegistrationCallback` API used for the production redirect allowlist, unlike 0.7.2, while accepting the test-only `accessTokenTTL: 1` override. Version 0.8.1 and later reject sub-60-second TTLs at construction.
- Production configuration is unchanged: `workers/oauth.ts` still sets `accessTokenTTL: 3_600`, `refreshTokenTTL: 2_592_000`, and `clientRegistrationTTL: 7_776_000`.
- Workerd's real KV service independently rejects `expirationTtl: 1`. The test fixture therefore proxies only that one KV `put` option to retain the token record for 60 seconds; it leaves the real provider's stored `expiresAt` at one second. The provider performs the expiry validation against that stored timestamp. No test clock, token parser, or production KV path is faked or changed.

### RED / GREEN record

- **RED:** Added a real DCR/S256 token flow that asks the fixture for `accessTokenTTL: 1`, waits 1,100 ms, and expects `/mcp` to return `401`. Against the original fixture/provider it failed (`200` rather than `401`); the old fixture never selected the override. Direct provider compatibility checks also confirmed 0.8.2 rejects that override at construction.
- **Investigation:** 0.7.2 accepts the option but both loses the current DCR callback enforcement and fails in workerd with `KV PUT failed: 400 Invalid expiration_ttl of 1`. Version 0.8.0 retains the callback and accepts the one-second option. Provider expiry is second-granularity and uses a strict `<` comparison, so the test waits until the final tenth of a second before issuing the token, then waits the required 1,100 ms; this avoids boundary flakiness without a fake clock.
- **GREEN:** The fixture applies the one-second override only for its explicit test header and uses real workerd KV storage with the minimum-retention adapter above. The exact real HTTP test now receives `401` for the expired access token.
- Added and ran real workerd coverage that seeds separate owner and attacker users, an owner project, conversation, and prompt-like message text directly in local D1. The attacker receives the stable public `not_found` shape for foreign project, conversation, namespaced `fetch`, and project/conversation resources; `search` cannot reveal the private title and none of the responses contains the private title or message body.
- Added and ran real HTTP MCP rate-limit coverage: the 61st `list_projects` call returns the public `rate_limited` result from the configured general limiter, and the 13th `get_conversation` call returns it from the stricter history limiter. The HTTP transport remains `200` for these MCP tool results, as required by the MCP protocol.

### Final verification

```text
npm run test:all   # 41 JS test files / 239 tests; 2 workerd files / 13 tests
npm run typecheck  # passed
npm run build      # passed
git diff --check   # passed
```

### Final concerns

- The workerd suite still emits upstream MCP SDK missing-source-map warnings and the intentional CIMD-disabled warning. They are dependency/runtime configuration noise; all tests pass.
- Provider 0.8.0 is intentionally pinned, rather than ranged, so future upgrades cannot silently reintroduce the provider's 60-second constructor guard and invalidate the real one-second expiry coverage.

## Final re-review remediation: request-safe transport and runtime success paths

### RED / GREEN record

- **RED:** Added `app/lib/mcp/__tests__/request-context.test.ts`, which imports a new request-scoped context API and runs two deliberately interleaved async calls with different user IDs/scopes. The targeted test failed before implementation because `request-context.server` did not exist.
- **GREEN:** Added `request-context.server.ts` with `AsyncLocalStorage`; `workers/mcp.ts` now creates a fresh public `WorkerTransport` and `McpServer` for each request, connects them directly, and runs the transport under that request-local context. `auth.server.ts` reads this context before the `agents/mcp` compatibility context. The interleaving test passes and the real workerd suite additionally issues concurrent OAuth `prompts/get` requests for two separately owned projects, asserting neither response contains the other project ID.
- Removed the isolate-global `console.error` replacement entirely. The previous `createMcpHandler` helper catches errors by writing raw thrown values to the global console. The direct transport path instead sets the per-server error callback to fixed structured `console.info` fields only (`event`, `errorClass`, method, and path), and replaces caught/5xx transport failures with the existing generic `internal_error` JSON-RPC result.
- **RED:** Extended the real DCR/S256 workerd flow to require a content-only `tools/call`, absence of `fresh_reads`, and a valid owned-project `prompts/get`. The first run found that the test isolate inherited `MOTHERDUCK_TOKEN` from local `.dev.vars`, so the catalog legitimately still contained `fresh_reads`.
- **GREEN:** The fixture now proxies its environment and exposes every real binding except `MOTHERDUCK_TOKEN`; this preserves provider service bindings while making the no-token runtime condition explicit. The runtime suite now verifies a `content:read` token successfully calls `list_learning_content`, `fresh_reads` is absent, and `continue_project` dispatches successfully with a seeded project owned by the OAuth user.

### Final verification

```text
npm test -- app/lib/mcp/__tests__/request-context.test.ts  # 1 test passed
npm run test:mcp                                            # 2 Worker test files / 14 tests passed
npm run test:all                                            # 42 JS test files / 240 tests; 2 Worker test files / 14 tests passed
npm run typecheck                                           # passed
npm run build                                               # passed
git diff --check                                            # passed
```

### Final concerns

- The workerd suite continues to emit upstream MCP SDK missing-source-map warnings and the intentional CIMD-disabled notice; neither is produced by the application code and all checks pass.
- The production Worker does not proxy or alter environment bindings. The `MOTHERDUCK_TOKEN` omission is fixture-only so the requested no-token catalog behavior can be asserted despite locally loaded development secrets.
