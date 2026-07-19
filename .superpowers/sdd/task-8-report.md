# Task 8 Report: Browser Artifact Resource Routes

Status: complete, with the renderer-preview capability intentionally fail-closed pending Task 11.

Implemented the registered authenticated browser routes for upload creation, file writes, finalization, abort, links, link replacement versions, metadata-only patches, deletion/recovery, version restore, and exact-version gallery sharing. Routes authenticate before parsing, use only the session identity, cap JSON at 64 KB, validate upload headers and actual body length, delegate to the artifact service, and send private no-store responses with safe error bodies.

Added delegation/privacy tests covering authentication order, input identity rejection, malformed headers, declared-versus-actual byte checks, session identity propagation, no-store/redaction behavior, foreign-record handling, and exact gallery-version selection.

The `/api/artifacts/:artifactId/capability` route authenticates and returns a safe 404. Capability issuance, signing, viewer-version resolution, and `{ previewUrl, expiresAt }` output remain a Task 11 dependency because no capability signer or renderer policy exists before that task; minting a route-local or unsigned claim would violate the artifact security boundary.

Verification: `npm test -- app/routes/__tests__/artifact-api.test.ts app/routes/__tests__/artifact-origin.test.ts` (69 passed) and `npm run typecheck` passed.

## Review remediation: method and authentication response boundaries

RED: Added direct-handler regression cases for an alternate verb in every action route family. They demonstrated that handlers authenticated and, for several routes, delegated before rejecting unsupported methods. Added unauthenticated redirect coverage for every artifact route family; these cases demonstrated that `requireUser` redirects escaped the artifact response helper without `Cache-Control: private, no-store`.

GREEN: Added a shared artifact method gate that returns the safe no-store response before authentication, body parsing, or service delegation. Each action route now declares only its registered verb or verbs. Added an artifact-only authentication adapter that preserves the thrown auth response's status and `Location`, while adding `Cache-Control: private, no-store`; the global `requireUser` behavior remains unchanged for non-artifact routes. The expanded artifact API suite passes with 26 tests.

## Review remediation: React Router framework dispatch

RED: Added Worker-path integration coverage backed by the real React Router request handler and resource-route manifest. Before the fix, GET, HEAD, and OPTIONS to action-only artifact resources were rejected by the framework before artifact code and returned no `Cache-Control`; a POST to the loader-only capability route likewise bypassed artifact policy.

GREEN: Every action-only artifact resource now exports a loader that rejects safely before authentication, parsing, or service work. The capability route gates its loader to GET before authentication and adds an action that safely rejects mutations. `artifactRejectMethod` centralizes the private no-store response used for these explicit dispatches. The Worker-path suite covers GET/HEAD/OPTIONS and alternate mutation verbs across all action-only resources, plus authenticated fail-closed capability GET and its rejected alternate dispatches.

Verification: RED `npm test -- app/routes/__tests__/artifact-api.test.ts` (10 expected dispatch failures); GREEN `npm test -- app/routes/__tests__/artifact-api.test.ts app/routes/__tests__/artifact-origin.test.ts` (107 passed) and `npm run typecheck` passed.

## P1 review remediation: origin-rejection cache policy

RED: Added a real Worker-dispatch regression for unsafe artifact upload requests with a missing, `null`, or disallowed `Origin`. All three reached the central write-origin rejection and returned `403` without `Cache-Control`, bypassing the artifact route policy before authentication or service work.

GREEN: The central unsafe-origin rejection now includes `Cache-Control: private, no-store`. This narrow, general boundary policy covers pre-router rejections for artifact requests while preserving the existing `403 Forbidden` behavior for every other website write.

Verification: RED `npm test -- app/routes/__tests__/artifact-api.test.ts` (3 expected cache-header failures); GREEN `npm test -- app/routes/__tests__/artifact-api.test.ts app/routes/__tests__/artifact-origin.test.ts` (110 passed), `npm test -- app/lib/artifacts app/routes/__tests__/artifact-origin.test.ts` (167 passed), `npm run test:worker` (44 passed), and `npm run typecheck` passed. `npm run test:security` remains blocked before test execution because Playwright discovery loads Vitest test modules and Vite-only `import.meta.glob` code; this remediation does not modify that harness.

## Final review remediation: bounded streaming upload bodies

- Replaced `request.arrayBuffer()` in the file-write route with a bounded
  `TransformStream`. Headers are still strictly validated; a declared value
  above `ARTIFACT_LIMITS.browserBytes` is rejected before the route pulls the
  request stream or calls storage. Otherwise, the production `putUploadFile`
  path receives the stream directly and the transform rejects the first byte
  beyond the declared size. The service continues to verify stored size and
  checksum, so short bodies and underdeclared bodies cannot become manifest
  rows.
- The response remains the artifact helper's safe `private, no-store` error.

### RED/GREEN evidence

- **RED:** `npm test -- app/routes/__tests__/artifact-api.test.ts` produced two
  expected failures: the over-limit case observed the route pull the body, and
  the underdeclared-body case never reached the streaming service boundary
  because the route had already buffered and rejected it.
- **GREEN:** route tests now prove that an over-limit declaration neither pulls
  beyond Request construction nor invokes `putUploadFile`, and that an
  underdeclared stream is passed to storage as a stream which rejects on the
  declared bound. The same test confirms the safe no-store error response.

| Command | Result |
| --- | --- |
| `npm test -- app/routes/__tests__/artifact-api.test.ts` | passed: 52 tests |
| `npm test -- app/lib/artifacts app/routes/__tests__/artifact-api.test.ts app/routes/__tests__/artifact-origin.test.ts` | passed: 257 tests |
| `npm run test:all` | passed: 45 Vitest files / 461 tests, 9 Worker files / 61 tests, 5 Playwright tests |
| `npm run typecheck` | passed |
| `npm run build` | passed |
| `git diff --check` | passed |
