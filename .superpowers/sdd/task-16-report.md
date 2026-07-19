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
| `npm run build` | passed |
| `npx wrangler deploy --dry-run` | blocked: copied `duckdb-eh.wasm` is 34.3 MiB; Workers asset limit is 25 MiB |

## Explicitly unrun or deferred gates

- Task 15 MCP create/version/retry/share/insufficient-scope E2E is gated on
  the companion MCP integration and was not implemented or tested.
- `npx wrangler deploy --config wrangler.renderer.jsonc --dry-run` is unrun:
  the unresolved 34.3 MiB WASM versus 25 MiB static-asset limit would block it.
- No runtime delivery architecture, remote provisioning, secrets, migrations,
  or deploy commands were changed or run.
