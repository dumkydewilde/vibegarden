# Task 9 report: Fetch proxy endpoint

## Status

Implemented the authenticated Agent Workbench fetch proxy endpoint and its
best-effort per-user rate limiter.

## Scope

Changed only the Task 9 implementation and report files:

- `app/lib/agents/fetch-guard.server.ts`
- `app/lib/agents/__tests__/fetch-guard.test.ts`
- `app/routes/api.fetch-proxy.ts`
- `app/routes.ts`
- `.superpowers/sdd/task-9-report.md`

The unrelated existing modification to `.superpowers/sdd/task-6-report.md`
was not changed or staged.

## Delivered behavior

- Adds `FETCH_RATE_LIMIT` with a default of 30 fetches per user per minute.
- Adds a timestamp-pruning limiter factory with injectable time for deterministic
  tests.
- Registers `POST /clubs/:clubSlug/api/fetch-proxy`.
- Resolves the user and club context using the existing API authorization
  convention before accepting a request.
- Validates a JSON object containing a string `url`, returns 400 for malformed
  input or refused fetches, and returns 429 when the user is rate-limited.
- Returns a capped, non-streaming JSON response containing status, content type,
  body, total character count, and truncation state.
- Keeps the limiter module-local in the route. It is per isolate and best
  effort; byte and time caps plus club credentials remain the primary limits.

## TDD evidence

The rate-limit test was appended before the limiter implementation.

Red run:

```text
npm test -- app/lib/agents/__tests__/fetch-guard.test.ts
Test Files  1 failed (1)
Tests       1 failed | 37 passed (38)
TypeError: rateLimiter is not a function
```

Green run after implementation:

```text
npm test -- app/lib/agents/__tests__/fetch-guard.test.ts
Test Files  1 passed (1)
Tests       38 passed (38)
```

The test verifies that 30 takes pass, the 31st fails, and a take exactly one
minute later passes.

## Final verification

```text
npm test -- app/lib/agents
Test Files  4 passed (4)
Tests       57 passed (57)

npm run typecheck
react-router typegen && tsc
exit 0

git diff --check
exit 0
```

An explicit scan found no en dash or em dash characters in the Task 9 source,
test, or report.

## Concerns

The limiter is intentionally best effort per Worker isolate. It does not impose
a globally shared quota, which is appropriate for this endpoint because the
existing SSRF, byte, timeout, redirect, and club authorization protections
remain in effect.
