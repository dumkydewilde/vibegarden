# Task 14 report

Implemented bounded, idempotent artifact retention cleanup and project deletion safeguards:

- `cleanupArtifacts` processes no more than 100 records in each category: expired non-complete upload state, standalone expired leases, then soft-deleted artifact data. It deletes R2 before its D1 row and preserves failed records for a later run.
- Cleanup retains active upload objects and finalized live artifact files. Expired soft-deleted artifacts are permanently removed only after their files are gone.
- Artifact logs and metrics accept only the allowlisted operation, opaque IDs, counts, bytes, duration, outcome, and stable error-code fields. Storage keys, paths, source content, tokens, and emails are dropped.
- The Worker cron runs cleanup via `ctx.waitUntil(Promise.allSettled(...))`, so a later independent scheduled subsystem can be composed without suppressing cleanup.
- Project deletion now throws `ProjectDeleteConflictError` when any artifact row remains, including a recoverable soft delete. The project screen explains the restore/remove or retention-cleanup path and keeps deletion disabled while listed artifacts remain.

Test-first evidence:

- The new observability test first failed because `observability.server.ts` did not exist.
- The worker cleanup test first failed because `cleanup.server.ts` did not exist.

Verification:

- `npm test -- app/lib/artifacts/__tests__/observability.test.ts app/routes/__tests__/artifact-detail.test.tsx` — 4 passed.
- `npm run test:worker -- test/worker/artifact-cleanup.test.ts` — 3 passed.
- `npm run typecheck` — passed.
- `git diff --check` — passed.

Review follow-up:

- Retention purge now removes completed upload history only when its expired soft-deleted artifact is physically purged, releasing the upload `project_id` foreign key. Project deletion uses a single guarded delete over both artifacts and uploads, returning `ProjectDeleteConflictError` rather than surfacing a D1 foreign-key error.
- Cleanup reserves expired uploads with `status = 'cleaning'` and retained artifacts with `cleanup_started_at` before any R2 deletion. Recovery/finalization can win before that conditional transition; otherwise the reservation blocks it and later cleanup retries remain bounded and durable.
- Added worker regressions for project deletion after retention purge and for restoration/finalization races preserving live D1 and R2 data.

Follow-up verification:

- `npm run test:worker -- test/worker/artifact-cleanup.test.ts test/worker/artifact-schema.test.ts test/worker/artifact-service.test.ts test/worker/artifact-lifecycle.test.ts` — 28 passed.
- `npm test -- app/lib/artifacts/__tests__/observability.test.ts app/routes/__tests__/artifact-detail.test.tsx` — 4 passed.
- `npm run typecheck` and `git diff --check` — passed.
