# Gardener MCP final hardening report

## Outcome

Completed the final whole-branch hardening pass without changing the approved
OAuth, search, or external-verification decisions. No deployment was made.

## Review findings resolved

1. **Fetch preflight parsing:** `workers/mcp.ts` now validates a `fetch` ID
   with `parseKnowledgeId`, the compatibility layer's authoritative namespace
   parser, before selecting the dynamic OAuth scope. A content-only token with
   malformed `project:` now receives the stable 200 JSON-RPC `invalid_input`
   result instead of an HTTP 403 scope challenge.
2. **Thrown-value safety:** temporary-failure classification only inspects real
   `Error` instances and protects access to `name` and `message`. Plain thrown
   objects, including objects with hostile accessors, are safely reported as
   the generic non-retryable `internal_error`.
3. **Presenter and cursor boundaries:** regression coverage asserts the
   20,000-character body/message cap, percent-encoded project, conversation,
   article, and module URLs, content offset first/middle/end pages and cursor
   emission, plus offset-zero, largest-timestamp, and invalid signed cursor
   boundaries.
4. **Compatibility fetch shapes:** project, conversation, article, and module
   fetches now have exact top-level-key assertions. The checks also verify
   internal storage/context fields and raw content implementation details do
   not leak.
5. **Production tool registration:** discovery order assertions derive from
   `MCP_TOOL_ORDER`, both without and with the optional `fresh_reads` backend.
   An in-memory MCP client additionally invokes `list_learning_content` over
   the actual protocol callback under request-scoped OAuth properties.
6. **Reviewer seed fail-closed parsing:** valid JSON now has to be a non-empty
   Wrangler result array whose entries are successful and contain a `results`
   array of `{ id: string }` rows. Any other valid JSON shape aborts before
   seed SQL can run.

## TDD record

- Added the malformed-ID Worker integration regression first; it failed with
  HTTP 403 and passed after authoritative parsing was moved ahead of scope
  selection.
- Added arbitrary-object/accessor and valid-but-unrecognized Wrangler JSON
  regressions first; they failed and passed after the respective hardening
  changes.
- Added presenter, cursor, compatibility, registration-order, and callback
  regressions. Existing production behavior passed the new boundary coverage;
  the registration callback test exercises the real SDK client/server protocol
  rather than an implementation mock.

## Verification

All final checks passed after the changes:

```text
npm run test:all
  47 JS test files / 269 tests
  2 Worker test files / 15 tests
npm run typecheck
npm run build
git diff --check
MCP_REVIEW_EMAIL='' node scripts/seed-mcp-reviewer.mjs
  expected immediate abort: MCP_REVIEW_EMAIL must be set before seeding reviewer data
```

The safe seed check exits before any Wrangler command, database write, or email
operation.

## Known non-blocking output

- Workerd reports missing upstream MCP SDK source maps and the intentional
  CIMD-disabled notice during Worker tests.
- Vite reports its existing large-chunk advisory during the production build.

Neither warning originates from this hardening change. No deployment, remote
seed, or external request was performed.
