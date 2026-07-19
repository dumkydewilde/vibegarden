# Task 8 Report: Browser Artifact Resource Routes

Status: complete, with the renderer-preview capability intentionally fail-closed pending Task 11.

Implemented the registered authenticated browser routes for upload creation, file writes, finalization, abort, links, link replacement versions, metadata-only patches, deletion/recovery, version restore, and exact-version gallery sharing. Routes authenticate before parsing, use only the session identity, cap JSON at 64 KB, validate upload headers and actual body length, delegate to the artifact service, and send private no-store responses with safe error bodies.

Added delegation/privacy tests covering authentication order, input identity rejection, malformed headers, declared-versus-actual byte checks, session identity propagation, no-store/redaction behavior, foreign-record handling, and exact gallery-version selection.

The `/api/artifacts/:artifactId/capability` route authenticates and returns a safe 404. Capability issuance, signing, viewer-version resolution, and `{ previewUrl, expiresAt }` output remain a Task 11 dependency because no capability signer or renderer policy exists before that task; minting a route-local or unsigned claim would violate the artifact security boundary.

Verification: `npm test -- app/routes/__tests__/artifact-api.test.ts app/routes/__tests__/artifact-origin.test.ts` (69 passed) and `npm run typecheck` passed.

## Review remediation: method and authentication response boundaries

RED: Added direct-handler regression cases for an alternate verb in every action route family. They demonstrated that handlers authenticated and, for several routes, delegated before rejecting unsupported methods. Added unauthenticated redirect coverage for every artifact route family; these cases demonstrated that `requireUser` redirects escaped the artifact response helper without `Cache-Control: private, no-store`.

GREEN: Added a shared artifact method gate that returns the safe no-store response before authentication, body parsing, or service delegation. Each action route now declares only its registered verb or verbs. Added an artifact-only authentication adapter that preserves the thrown auth response's status and `Location`, while adding `Cache-Control: private, no-store`; the global `requireUser` behavior remains unchanged for non-artifact routes. The expanded artifact API suite passes with 26 tests.
