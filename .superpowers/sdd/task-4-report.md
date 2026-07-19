# Task 4: Private R2 Object Store and Owned Artifact Repository

## Status

Complete. The server-only R2 and D1 persistence boundary is implemented without
changing Task 5 service or UI work.

## Implementation

- Added immutable server-composed object keys in the exact
  `artifacts/{artifactId}/versions/{versionId}/{path}` shape. IDs and relative
  paths are validated, so a path cannot escape the version prefix.
- Added checksum-enforced R2 writes. The lowercase SHA-256 is passed to R2,
  compared with both the returned and subsequently inspected object checksum,
  and MIME is supplied only through `httpMetadata.contentType`. No custom
  metadata is written.
- Added version-scoped reads and validated private-object deletion.
- Added owned D1 reads for projects, uploads, artifacts, versions, object
  leases, and idempotency records. Each private target query includes the
  authenticated user ID in its SQL predicate.
- Added a gallery lookup that joins only `gallery_version_id`, requires
  `visibility = 'gallery'` and `deleted_at IS NULL`, and never resolves the
  current version pointer.
- Added D1 batch finalizers for new uploaded artifacts, existing artifact
  versions, and new links. New and existing upload finalization complete the
  upload and delete leases in the same batch. Existing versions derive
  `MAX(version_number) + 1` inside an owned-artifact query and update only the
  current pointer. Unique version races become retryable `state_conflict`.

## Files changed

- `app/lib/artifacts/object-store.server.ts`
- `app/lib/artifacts/repository.server.ts`
- `test/worker/artifact-object-store.test.ts`
- `test/worker/artifact-repository.test.ts`

## TDD evidence

### RED

1. The initial targeted Worker run failed because both requested production
   modules were absent.
2. After the first repository implementation, the finalization tests failed
   with the D1 `artifact_versions_source_check` constraint. The tests exposed
   that browser source values must be persisted as `web` and MCP values as
   `mcp`.

### GREEN

`npm run test:worker -- test/worker/artifact-object-store.test.ts test/worker/artifact-repository.test.ts`

- 2 files passed, 9 tests passed.
- Covers checksum rejection, metadata placement, prefix escape prevention,
  cross-user record isolation, cross-user upload mutation rejection,
  gallery-version resolution, and all three finalization batches.

`npm run typecheck`

- Passed.

`git diff --check`

- Passed.

## Self-review

- R2 keys are always validated/recomposed beneath an immutable artifact and
  version prefix; the storage functions have no source-metadata input.
- Private repository functions use user predicates with target IDs in the same
  SQL query. The gallery read is intentionally not owner-bound and has its own
  strict visibility/deletion/exact-version conditions.
- Finalization code never writes `gallery_version_id` or gallery visibility.
- The new-artifact batch requires an owned, finalizing upload before it can
  create its artifact row. Existing-version insertion itself is owner-scoped.

## Concerns

- The object-store surface is server-only but accepts an `r2Key` parameter as
  specified. Task 5 must continue constructing it with `artifactObjectKey` and
  must not pass caller-provided object keys into this boundary.
- The unrelated pre-existing untracked file
  `docs/plans/2026-07-18-artifact-upload-and-rendering.md` was left untouched.

## Task review findings

The task reviewer found two issues requiring a fix and re-review:

1. Immutable R2 writes lack a create-only conditional, allowing a key to be overwritten.
2. Upload finalization must bind the owned finalizing upload, artifact/version identity, file metadata, and leases in the same batch rather than accepting detached caller-supplied values.

## Review remediation

### RED

- The create-only object regression failed when its R2 conditional was removed:
  the second write resolved with a seven-byte object rather than rejecting with
  `state_conflict`.
- The focused finalization regressions initially failed because the finalizers
  required detached caller-supplied artifact, version, and file values. A
  cross-upload finalization raised while trying to read those absent values,
  and a cross-user finalization did not yield the required ownership conflict.
- The aggregate metadata regression initially recorded `file_count = 2` and
  `total_bytes = 10` for one five-byte upload when the target artifact already
  had two versions. This exposed the join multiplication risk while deriving
  `MAX(version_number) + 1`.

### GREEN

`npm run test:worker -- test/worker/artifact-object-store.test.ts test/worker/artifact-repository.test.ts`

- Passed: 2 files, 12 tests.
- Includes create-only overwrite rejection; cross-upload and cross-user
  finalization/lease isolation; server-recorded manifest file count and byte
  totals; and the existing ownership, gallery, and batch tests.

`npm run typecheck`

- Passed.

`git diff --check`

- Passed.

### Files

- `app/lib/artifacts/object-store.server.ts`
- `app/lib/artifacts/repository.server.ts`
- `test/worker/artifact-object-store.test.ts`
- `test/worker/artifact-repository.test.ts`

### Commit

- `861133b fix: bind artifact finalization to uploads`

### Self-review

- `putLeasedObject` uses R2's `etagDoesNotMatch: "*"` condition and maps a
  precondition result to retryable `state_conflict`, preserving the first
  immutable object unchanged.
- Upload finalizers now take only `uploadId` and `now`. Artifact, version,
  project, source, manifest file, count, byte, and lease data come from the
  owned finalizing upload rows; no detached caller object or file values are
  accepted.
- File leases are validated against the same upload, user, key, checksum, and
  byte size before finalization. Lease deletion is scoped to that upload and
  its recorded file keys.
- Existing-version aggregate file metadata uses scalar upload-manifest
  aggregates, avoiding multiplication by the artifact's pre-existing versions.

## Re-review findings

The re-review found two Important issues requiring a fix:

1. Finalization must require unexpired finalizing uploads and leases so cleanup cannot reclaim objects for a newly committed version.
2. New link creation must prove project ownership in the insert statement rather than relying on a migration trigger.

## Second re-review remediation

### RED

Added three failing-first repository regressions and ran:

`npm run test:worker -- test/worker/artifact-repository.test.ts`

- 1 file ran: 8 passed, 3 failed.
- An expired finalizing upload resolved instead of rejecting and could consume its
  lease.
- An expired finalization lease resolved instead of rejecting.
- Cross-user link creation failed through the schema trigger rather than the
  stable `state_conflict` result required by the repository boundary.

### GREEN

`npm run test:worker -- test/worker/artifact-object-store.test.ts test/worker/artifact-repository.test.ts`

- 2 files passed, 15 tests passed.
- Covers expired-upload and expired-lease rejection without creating or moving
  artifact/version/file state, and without completing the upload or deleting
  its lease.
- Covers cross-user link creation against another user's project, which now
  returns `state_conflict` without creating an artifact or version.

`npm run typecheck`

- Passed.

`git diff --check`

- Passed.

### Files

- `app/lib/artifacts/repository.server.ts`
- `test/worker/artifact-repository.test.ts`
- `.superpowers/sdd/task-4-report.md`

### Commit

- `34c4deb fix: enforce artifact finalization expiry`

### Self-review

- Each upload finalizer now requires the owned upload to be `finalizing` and
  unexpired at `input.now` for artifact/version/file inserts, pointer movement,
  and upload completion. Every manifest lease match also requires
  `expires_at > input.now`.
- Lease cleanup is restricted to unexpired leases from a successfully completed,
  still-unexpired owned upload, so a rejected expired upload cannot consume
  reclaimable objects.
- Link creation inserts its artifact via an owned-project `INSERT ... SELECT`.
  The dependent version insert is likewise owner-scoped, and all batch result
  counts are checked so an absent owned project becomes the stable retryable
  `state_conflict` error rather than a trigger-dependent database error.
