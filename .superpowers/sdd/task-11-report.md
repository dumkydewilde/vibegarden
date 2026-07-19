# Task 11 Report: Signed Capability Codec and Renderer Policy
Status: complete.

Implemented the v1 renderer capability codec with canonical base64url JSON and
HMAC-SHA256 signatures. Issuance rejects empty or reused renderer/session
secrets, malformed claims, non-v1 versions, invalid modes, non-immutable
prefixes, non-normalized paths, and non-canonical data origins. Verification
uses WebCrypto verification, returns no failure detail, rejects expired and
non-canonical tokens, and validates the exact claim shape.

Added deterministic renderer CSP, Permissions Policy, and fresh response
headers. The CSP is server-owned, allows only the approved static hosts and
declared HTTPS data origins, contains no wildcard parent or connect source, and
uses explicit production or loopback development parents. Capability responses
are private/no-store, nosniff, and no-referrer. Only runtime and data assets
receive credential-free CORS.

TDD evidence: the two focused suites first failed because their modules did not
exist. After implementation, `npm test --
app/lib/artifacts/__tests__/capability.test.ts
app/lib/artifacts/__tests__/policy.test.ts` passed (19 tests), `npm run
typecheck` passed, and `git diff --check` passed. The broader artifact/origin
suite passed (197 tests) and the Worker suite passed (46 tests).

`npm run test:security` was attempted but is currently misconfigured:
`playwright test` collects Vitest suites and fails before security fixtures run
with errors including "Vitest mocker was not initialized" and
`import.meta.glob is not a function`. This task does not modify the Playwright
configuration or the affected suites.

## Review remediation (2026-07-19)

Capability issuance now accepts an optional deterministic Unix-second clock and
requires `exp` to equal `now + ARTIFACT_LIMITS.capabilityTtlSeconds` exactly.
Verification also rejects correctly HMAC-signed claims whose expiry is more
than that five-minute window ahead of the verifier clock, so a years-long
claim is neither issuable nor valid. Tests cover the one-second-short,
one-second-long, and years-long boundaries, as well as correctly signed future
token and policy versions.

The signature-tampering test now deterministically replaces its final base64url
character with a different value, eliminating the prior same-character flake.

Added the required uploaded-content negative fixture at
`test/security/fixtures/forbidden.html` and the focused Playwright assertion in
`test/security/artifact-policy.spec.ts`. It verifies that an uploaded attempt
to set permissive CSP/CORS values or an untrusted download capability cannot
widen the server-owned entry response policy. The fixture is deliberately a
standalone artifact for Task 16's renderer-boundary coverage to reuse.

TDD evidence: lifetime tests first failed because issuance accepted off-boundary
and years-long expiries and verification accepted a correctly signed years-long
claim. The security assertion first failed because the mandatory fixture was
absent. After the changes, the focused capability/policy tests passed (25
tests), the focused security test passed (1 test), `npm run typecheck` passed,
and `git diff --check` passed.
