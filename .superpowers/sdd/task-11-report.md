# Task 11: Grant Revocation, Reviewer Login, and Public Documentation

## RED

Added route-level tests for user-owned OAuth grant listing/revocation,
cross-origin POST rejection, reviewer POST-only login and normal-user role,
and public connection/privacy disclosures.

Ran:

```sh
npm test -- app/routes/__tests__/settings-connections.test.tsx app/routes/__tests__/review-login.test.tsx app/routes/__tests__/mcp-public-docs.test.tsx
```

Result: failed as expected because `settings.connections`, `review.login`,
`connect`, and `privacy.mcp` routes did not exist.

## GREEN

- Added authenticated `/settings/connections`, with `requireUser`, owner-bound
  `listUserGrants` and `revokeGrant`, same-origin POST checking, and HMAC-hashed
  revocation audit fields.
- Added isolated `/review/login`. GET only renders the form; POST rate-limits a
  fixed key, makes SHA-256 byte-array comparisons for both normalized email and
  password, returns one generic error for all failures, forces the persisted
  reviewer role to `user`, then creates the normal `vg_session` cookie.
- Added public `/connect` and `/privacy/mcp` pages plus README setup, operation,
  reviewer-seeding, and revocation guidance.
- Added an idempotent reviewer seeder using deterministic SHA-256-derived UUIDs,
  escaped SQL literals, and only deterministic reviewer IDs. It exits before any
  remote command when `MCP_REVIEW_EMAIL` is absent; the remote command was not
  run during this task.

## Verification

| Command | Result |
| --- | --- |
| `npm test -- app/routes/__tests__/settings-connections.test.tsx app/routes/__tests__/review-login.test.tsx app/routes/__tests__/mcp-public-docs.test.tsx` | PASS — 3 files, 8 tests |
| `npm run test:all` | PASS — 45 app files / 248 tests; 2 MCP files / 15 tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `env -u MCP_REVIEW_EMAIL node scripts/seed-mcp-reviewer.mjs` | PASS — exits before remote execution with the expected required-variable error |
| `git diff --check` | PASS |

The MCP test run emitted existing third-party sourcemap warnings from
`@modelcontextprotocol/sdk`; it still exited successfully. The production build
emitted its existing chunk-size advisory and exited successfully.

## Review Repair

### RED

Added failing coverage for non-POST reviewer-login and grant-revocation
actions, four SHA-256 comparisons when credentials or reviewer configuration
are invalid, deterministic reviewer identity, legacy-admin demotion,
idempotent seed SQL, and the exact MCP return fields disclosed publicly.

### GREEN

- Both sensitive actions now reject every non-POST request with `405` and
  `Allow: POST` before parsing form data or touching authentication services.
- Reviewer login continues all four SHA-256 calculations before returning the
  generic invalid-credentials response. New reviewer accounts use the same
  deterministic UUIDv5-shaped SHA-256 identity as the seeder; an existing
  matching account is demoted to `user` without replacing its identity.
- The seeder exposes deterministic SQL generation for test coverage, inserts
  a reviewer only when its email is absent, resolves an existing reviewer by
  email for new sample rows, and updates only the deterministic reviewer row
  and deterministic sample rows. It performs no remote work when the required
  environment variable is absent.
- The privacy page now enumerates the exact project, conversation, article,
  module, and fresh-read response fields.

### Verification

| Command | Result |
| --- | --- |
| `npm test -- app/routes/__tests__/settings-connections.test.tsx app/routes/__tests__/review-login.test.tsx app/routes/__tests__/mcp-public-docs.test.tsx` | PASS — 3 files, 16 tests |
| `npm run test:all` | PASS — 47 app files / 258 tests; 2 MCP files / 15 tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `env -u MCP_REVIEW_EMAIL node scripts/seed-mcp-reviewer.mjs` | Expected failure before any remote command: `MCP_REVIEW_EMAIL must be set before seeding reviewer data.` |
| `git diff --check` | PASS |

The MCP test run still emits third-party `@modelcontextprotocol/sdk` sourcemap
warnings, and the build still emits its existing chunk-size advisory; both
commands exit successfully.

## Identity Collision Repair

### RED

Added regression coverage for a valid reviewer credential whose configured
email is already owned by a different participant ID, an `upsertUser` call
with a conflicting forced reviewer ID, and deterministic seeder preflight
rejection before it can compose or execute sample-row writes. Added an
idempotence assertion for an existing deterministic reviewer ID.

### GREEN

- `upsertUser` now returns `null` before changing any existing user whenever a
  caller requires a different deterministic ID. Reviewer login turns that
  result into the existing `Invalid reviewer credentials` response and creates
  no session.
- The reviewer seeder first executes a read-only JSON preflight for the email.
  It aborts when the resolved ID differs from the deterministic reviewer ID;
  subsequent seed SQL binds every sample row directly to the deterministic ID,
  never an email lookup.

### Verification

| Command | Result |
| --- | --- |
| `npm test -- app/routes/__tests__/settings-connections.test.tsx app/routes/__tests__/review-login.test.tsx app/routes/__tests__/mcp-public-docs.test.tsx` | PASS — 3 files, 17 tests |
| `npm run test:all` | PASS — 47 app files / 262 tests; 2 MCP files / 15 tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `env -u MCP_REVIEW_EMAIL node scripts/seed-mcp-reviewer.mjs` | Expected failure before any Wrangler command: required-variable error |
| `git diff --check` | PASS |
