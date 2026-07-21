# Task 12 Report: Isolated Artifact Renderer and Pinned DuckDB Runtime

Status: implemented; deployment validation is blocked by an upstream Workers
static-asset size limit described below.

Implemented `workers/renderer.ts` as a separately typed Worker with only the
private artifact bucket, static-assets binding, Analytics Engine binding,
dedicated renderer signing secret, and parent origin. It exposes only signed
`/v1/{capability}/{relativePath}` requests and the literal DuckDB 1.33.1-dev57.0
runtime allowlist. Preview entries require `Sec-Fetch-Dest: iframe` and
`Sec-Fetch-Mode: navigate`; downloads are entry-only attachments. Renderer
responses take only R2 `httpMetadata.contentType`, build all policy headers
server-side, never merge object metadata, and return fixed private errors.

The previous fixture-only Task 11 Playwright assertion was removed. Its
`forbidden.html` fixture is now placed in R2 and requested through the actual
renderer Worker in `test/worker/renderer.test.ts`. The real negative proof
asserts that hostile CSP/CORS/capability metadata and R2 header metadata cannot
widen the response, and that a capability signed with a wrong secret receives a
fixed rejection. The suite also covers valid preview entry/asset/data delivery,
download-only entry paths, expiry, tampering, traversal, Fetch Metadata,
missing objects, the runtime allowlist, fixed error bodies, and safe attachment
filenames.

`scripts/copy-renderer-runtime.mjs` validates the installed
`@duckdb/duckdb-wasm` package version before copying exactly
`duckdb-browser-eh.worker.js` and `duckdb-eh.wasm`. It performs no deletion.
The generated files byte-match their pinned package sources and are the only
files beneath `public/renderer`.

`wrangler.renderer.jsonc` uses the private artifact R2 bucket, Analytics
Engine, the `public/renderer` static assets binding, the
`usercontent.vibegarden.club` custom domain, `PARENT_ORIGIN`, and
`observability.enabled: false`; it intentionally has no D1, session, OAuth,
mail, or website bindings/variables.

Verification:

- `npm run copy:renderer-runtime` passed; both runtime files byte-match their
  pinned sources.
- `npm test -- app/lib/artifacts app/routes/__tests__/artifact-origin.test.ts`
  passed: 203 tests.
- `npm run test:worker` passed: 52 tests, including all six renderer-boundary
  tests.
- `npm run cf-typegen` and `npm run typecheck` passed.
- `git diff --check` passed.

Deployment constraint:

`npx wrangler deploy --dry-run --config wrangler.renderer.jsonc` fails before
uploading because Wrangler enforces a 25 MiB static-asset limit and the required
unmodified `duckdb-eh.wasm` is 34.3 MiB. This is an unresolved conflict between
the task's exact-copy/static-assets requirements and the platform limit. The
configuration has deliberately not been changed to route around that boundary.

The project-wide `npm run test:security` is also still pre-existingly
misconfigured: Playwright collects Vitest suites and fails before collecting
security specs (for example, `Vitest mocker was not initialized` and
`import.meta.glob is not a function`). The real renderer security proof runs in
the Worker suite and passes.
