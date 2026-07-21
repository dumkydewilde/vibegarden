# Task 6: Lifecycle, reads, and privacy-safe presenters

## Scope completed

- Added owner metadata updates, version restore, exact-version gallery share/update, gallery removal, soft deletion, and 30-day recovery to `app/lib/artifacts/service.server.ts`.
- Added strict owner and gallery reads, owner/gallery listing, and retained-version reads. Owner resolution uses the existing owner repository predicate; gallery resolution uses the repository's exact `gallery_version_id` predicate.
- Added `app/lib/artifacts/presenters.server.ts` with separate owner, gallery, detail, and version output shapes.
- Added lifecycle state-table coverage and presenter privacy tests.

## Lifecycle guarantees

- Metadata is trimmed and capped, updates `updated_at`, and never creates an artifact version.
- Restore accepts only a retained version of the same owned artifact and changes only `current_version_id`.
- Sharing atomically writes `visibility = 'gallery'` and the selected same-artifact `gallery_version_id`. Unshare atomically clears the pointer and returns to `private`.
- Upload/version finalization remains responsible for `current_version_id` only, preserving a previously saved gallery pointer.
- Soft deletion is immediately hidden by the existing owner/gallery repository queries. Recovery clears deletion only when `deleted_at >= now - 30 days`; expiry returns the stable `not_found` error.
- `public` remains a reserved database value and is rejected by the service transition API.

## Presentation/privacy guarantees

- Owner summaries include artifact/project IDs, project title, metadata, type, current/gallery summaries, visibility, update time, and `/artifacts/{id}` URL.
- Gallery output includes only the exact gallery version and participant display name. It omits email, user ID, and current-version data.
- Details and version shapes include normalized origins and file path/MIME/size/checksum only. They never include R2 keys, upload leases, or renderer capability claims.

## Test-first evidence

The initial red run failed as intended because `presenters.server.ts` did not yet exist:

```text
Failed to resolve import "../presenters.server"
```

After implementation, these passed:

```text
npm test -- app/lib/artifacts/__tests__/presenters.test.ts
# 3 passed

npm run test:worker -- test/worker/artifact-lifecycle.test.ts
# 4 passed

npm run typecheck
# passed
```

## Scope intentionally deferred

No routes, UI, public capabilities, renderer work, or R2 cleanup behavior was added in this task.

## Review remediation (2026-07-19)

### RED evidence

Before production changes, the focused presenter test failed because the gallery service read shape contained `version`, while `presentGalleryArtifact` required the owner-oriented `galleryVersion` field:

```text
Error: Gallery artifacts require a gallery version.
```

The lifecycle test also failed before the metadata change because strings longer than the arbitrary pre-validation threshold were rejected before `trimAndCap` could apply:

```text
ArtifactError: Artifact input is invalid.
```

The replacement post-share lifecycle test already passed once it used `createTextArtifactVersion`: that service path performs a real upload, manifest finalization, and current-pointer update, so no production lifecycle fix was needed for that behavior.

### GREEN evidence

- Gallery read/detail and list outputs now use the dedicated `GalleryArtifactPresentation` contract. It has no `projectId`, account identifier, or current-version field, and it feeds `presentGalleryArtifact` directly.
- Metadata validates normal string/null input types but trims and caps any string at the exact `ARTIFACT_LIMITS.titleChars` / `ARTIFACT_LIMITS.descriptionChars` boundaries.
- The post-share lifecycle test creates and finalizes a real HTML version through `createTextArtifactVersion`, verifies that owner current moves to the new version, and verifies the pinned gallery version remains `version-1`.

Final verification:

```text
npm test -- app/lib/artifacts/__tests__/presenters.test.ts
# 3 passed

npm run test:worker -- test/worker/artifact-lifecycle.test.ts test/worker/artifact-service.test.ts
# 16 passed

npm run typecheck
# passed
```
