# Task 16 report

## Delivered

- Added a Playwright-only security configuration that discovers only
  `test/security/**/*.spec.ts`.
- Added a two-host local Worker harness: `vibegarden.test` serves the wrapper
  and seed endpoints; `usercontent.vibegarden.test` calls the real renderer
  handler over the same local R2 bucket. The harness uses explicit origins and
  a signing secret distinct from its session secret.
- Expanded the mandatory forbidden fixture and added browser proof for opaque
  sandbox isolation, blocked DOM/storage/cookie/write/navigation/popup/frame
  attempts, denied capabilities, and invalid renderer capabilities.
- Added positive browser proof for relative HTML/CSS/JS/image/font assets,
  packaged CSV/Parquet bytes, declared remote CSV CORS, and denied undeclared
  remote data. Added CORS for packaged font extensions so fonts can load from
  the opaque sandbox; the worker regression test covers it.
- Added the renderer runbook, README release gate, and roadmap status. Phase 5
  remains unchecked until production verification.

## Verification

| Command | Result |
| --- | --- |
| `npm run copy:renderer-runtime` | passed |
| `npm test` | passed: 45 files, 458 tests |
| `npm run test:worker` | passed: 9 files, 61 tests |
| `npm run test:security` | passed: 4 Playwright specs |
| `npm run typecheck` | passed |

## Final review remediation: renderer-hosted DuckDB EH runtime proof

- The positive Chromium fixture now constructs an explicit single-thread EH
  bundle instead of calling `getJsDelivrBundles().mvp`. Its worker and WASM
  URLs are `usercontent.vibegarden.test` renderer runtime routes for the
  pinned `duckdb-browser-eh.worker.js` and `duckdb-eh.wasm` files.
- The browser assertion records and verifies both selected URLs while querying
  packaged CSV and real Parquet bytes. The real renderer handler still serves
  the browser-visible runtime route and its CORS headers.
- The security fixture starts a local Vite static server only as the fixture
  implementation of the renderer's asset binding. This avoids adding the
  known 34.3 MiB WASM to a Workers asset binding, so production static
  architecture and its documented 25 MiB deployment conflict are unchanged.

### RED/GREEN evidence

- **RED:** `npx playwright test test/security/artifact-flows.spec.ts --grep
  'signed preview loads'` failed after adding the runtime URL assertion:
  expected the EH renderer worker URL, received no `data-worker-url` attribute.
  The fixture was selecting the jsDelivr MVP bundle.
- **GREEN:** the same command passed after selecting the explicit renderer EH
  bundle; it executed the CSV and Parquet queries in Chromium and asserted:
  `http://usercontent.vibegarden.test:8788/runtime/duckdb/1.33.1-dev57.0/duckdb-browser-eh.worker.js`
  and `http://usercontent.vibegarden.test:8788/runtime/duckdb/1.33.1-dev57.0/duckdb-eh.wasm`.

| Command | Result |
| --- | --- |
| `npx playwright test test/security/artifact-flows.spec.ts --grep 'signed preview loads'` | passed: 1 Chromium test |
| `npm run test:security` | passed: 5 Playwright tests |
| `npm run test:all` | passed: 45 Vitest files / 461 tests, 9 Worker files / 61 tests, 5 Playwright tests |
| `npm run typecheck` | passed |
| `npm run build` | passed |
| `git diff --check` | passed |

## P1 remediation: real product-flow fixture

- Replaced the `FlowArtifact` map and handwritten state transitions in
  `test/security/fixture-worker.ts`. The flow endpoint now creates browser
  uploads (session, R2 write, manifest, and finalize), links, inline draft
  projects, versions, metadata, restore, gallery pin/removal, delete/recovery,
  and capabilities through the production artifact service/repository.
- The security fixture now has a local D1 binding, applies the real `drizzle`
  migrations before Playwright starts, and resets only its local D1/R2 fixture
  data. Renderer preview and attachment URLs are issued by the production
  renderer capability service and served by the unchanged second renderer host.
- Protected fixture writes now call `assertWebsiteWriteOrigin`; the browser
  proof still verifies an opaque iframe reaches that guard without a cookie and
  causes no mutation. No fixture-owned origin predicate remains.

### RED/GREEN evidence

- **RED:** added a browser request in which `user-b` reads a private artifact
  ID made by `user-a`. The prior map implementation returned `200`; the test
  failed with `Expected: 404, Received: 200`.
- **GREEN:** the same flow now returns `404` through `getOwnedArtifact`, while
  the owner flow passes using actual D1 ownership, current/gallery pointers,
  retained versions, and R2 objects.

| Command | Result |
| --- | --- |
| `npx playwright test test/security/artifact-flows.spec.ts --grep 'browser product flow'` | passed |
| `npm run test:security` | passed: 5 Playwright tests |
| `npm run test:worker` | passed: 9 files, 61 tests |
| `npm run typecheck` | passed |
| `git diff --check` | passed |

The initially observed full-suite rendering failure was transient while the
fixture harness was being changed. The final clean release run passes
`npm test`: 45 files and 459 tests.
| `npm run build` | passed |
| `npx wrangler deploy --dry-run` | blocked: copied `duckdb-eh.wasm` is 34.3 MiB; Workers asset limit is 25 MiB |

## Explicitly unrun or deferred gates

- Task 15 MCP create/version/retry/share/insufficient-scope E2E is gated on
  the companion MCP integration and was not implemented or tested.
- `npx wrangler deploy --config wrangler.renderer.jsonc --dry-run` is unrun:
  the unresolved 34.3 MiB WASM versus 25 MiB static-asset limit would block it.
- No runtime delivery architecture, remote provisioning, secrets, migrations,
  or deploy commands were changed or run.

## Review remediation (browser evidence)

- Replaced pre-filled forbidden-fixture outcomes with observed browser results.
  The probe now attempts form submission and nested-frame creation; the browser
  reports both blocked, while the fixture records that no form request arrived.
- Added a browser session cookie before the malicious credentialed write. The
  protected endpoint receives the request, records that the opaque iframe sent
  no cookie, rejects it at the explicit same-origin guard, and records zero
  mutations. This distinguishes the central mutation guard from the browser's
  CORS-visible rejection.
- Added browser-driven fixture state transitions for upload sources, metadata,
  version retention/restore, gallery pin/update/removal, wrappers, capability
  refresh state, delete/recovery, and attachment download. Each preview and
  download still uses the real renderer and local R2 rather than component
  mocks. Task 15 MCP remains deferred.
- The positive fixture now uses actual pinned DuckDB-Wasm and reads a real
  DuckDB-generated Parquet file plus CSV in Chromium. It loads a valid pinned
  Roboto WOFF2 and asserts `document.fonts`. No byte-fetch stand-ins remain.

| Additional command | Result |
| --- | --- |
| `npm test -- app/lib/artifacts/__tests__/validation.test.ts` | passed: 77 tests |
| `npm run test:worker` | passed: 9 files, 61 tests |
| `npm run test:security` | passed: 5 Playwright tests |
| `npm run typecheck` | passed |
