# Task 7 report: central origin guard and stable HTTP errors

## Scope

- Added a Worker-level exact-origin guard before every React Router website request.
- Moved React Router request-handler construction to `workers/react-router.ts`; `workers/app.ts` delegates to it, leaving a clean seam for later Worker OAuth/MCP routing.
- Added safe artifact JSON error serialization and HTTPS host-only cookie coverage.
- Did not add Task 8 resource routes, alter mail configuration, or change renderer bindings/boundaries.

## TDD evidence

### RED

```text
npm test -- app/lib/__tests__/request-security.test.ts app/routes/__tests__/artifact-origin.test.ts app/lib/__tests__/auth.test.ts
exit 1
```

The new guard and artifact HTTP modules were unresolved, and the new HTTPS OAuth cookie assertion failed because the state cookie lacked `Secure`.

### GREEN

```text
npm test -- app/lib/__tests__/request-security.test.ts app/routes/__tests__ app/lib/__tests__/auth.test.ts
10 files passed, 104 tests passed.

npm run typecheck
react-router typegen && tsc
exit 0
```

The focused artifact boundary and Worker checks also passed:

```text
npm test -- app/lib/artifacts app/routes/__tests__/artifact-origin.test.ts
5 files passed, 167 tests passed.

npm run test:worker
6 files passed, 44 tests passed.
```

## Security coverage

- Every registered current action path is table-tested at the central boundary: login, logout, welcome, garden/project/conversation actions, inspiration, learning, chat, thread, feedback, and admin.
- `POST`, `PUT`, `PATCH`, and `DELETE` accept only explicit configured website origins. Missing, `null`, renderer, unrelated, prefix-lookalike, and wildcard origins receive 403. `GET`, `HEAD`, and `OPTIONS` remain unchanged.
- Session creation/destruction and Google OAuth state cookies are `Secure` on HTTPS, `HttpOnly`, `SameSite=Lax`, and contain no `Domain` attribute.
- `artifactJsonAction` returns the existing safe `ArtifactError.toPublic()` projection only. Unknown exceptions become `{ "error": "internal_error" }` with status 500.

## Additional validation note

`npm run test:security` does not have a runnable Playwright configuration in this checkout. With no `playwright.config.*`, Playwright defaults to discovering all `*.test.*` files and then attempts to run Vitest unit suites, failing before a security test can start (for example, `Vitest mocker was not initialized` and `import.meta.glob is not a function`). This is outside Task 7's changed files; the required focused tests, worker tests, and typecheck pass.

## Commit

Pending commit: `security: require exact origins for website writes`.
