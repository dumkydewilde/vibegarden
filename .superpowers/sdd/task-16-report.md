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

`npm test` was also run after the scoped checks. It has one pre-existing,
unrelated failure in `app/routes/__tests__/artifact-rendering.test.tsx`: its
full-screen wrapper test remains at `Loading preview…` and cannot find the
iframe. This remediation does not change `ArtifactFrame`, React routes, or
that test; the focused security, worker, validation, and type checks above
pass.
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
