# Task 6 report: Workbench routes and minimal UI

## Status

Implemented the first end-user Agent Workbench UI: agent listing and creation,
prompt editing and version saves, plain streaming chat, the assembled system
prompt preview, route registration, and navigation.

## Scope

- `app/routes/garden.agents.tsx`: authenticated owned/shared lists and create action
- `app/routes/garden.agents.$id.tsx`: authenticated workbench loader, save action,
  prompt editor, chat, and assembled-prompt preview
- `app/components/workbench/use-agent-chat.ts`: streaming text chat hook
- `app/components/workbench/__tests__/use-agent-chat.test.ts`: hook contract tests
- `app/routes.ts`: both nested routes after the garden modules route
- `app/lib/nav.ts`: `Agent Workbench` navigation item
- `app/components/shell/left-nav.tsx` and `mobile-nav.tsx`: exact matching for
  the parent Idea Garden item so only Agent Workbench is active on its routes

No tools, skills, memory, trace, sharing controls, remix flow, or conversation
persistence were added.

## Behavior

The list route returns `{ mine, shared }`, shows both groups in readable tables,
and creates a private prompt-only agent from a name and description. Successful
creation redirects to that agent's workbench.

The workbench loader returns the repository's `{ agent, version, definition }`
plus editability and the assembled prompt. Owners can edit name, description,
and `definition.systemPrompt`; saving posts the full definition JSON through a
hidden field, validates it with `parseAgentDefinition`, and creates a new version
through `saveAgentVersion`. Shared agents are read-only but remain testable.

The chat hook posts the saved version and visible chat history to the existing
agent endpoint, appends the user turn immediately, reads text chunks with a body
reader and `TextDecoder`, appends deltas to the last assistant entry, exposes a
busy state, and supports reset. Non-OK and transport failures render the generic
`not reachable` assistant response.

## TDD evidence

Red run after adding only the requested hook test:

```text
npm test -- app/components/workbench
FAIL app/components/workbench/__tests__/use-agent-chat.test.ts
Error: Failed to resolve import "../use-agent-chat"
Test Files  1 failed (1)
Tests       no tests
```

This was the expected failure because the hook module did not exist.

Green run after implementing the hook:

```text
npm test -- app/components/workbench
Test Files  1 passed (1)
Tests       2 passed (2)
```

The stream test held the second chunk back so it could observe `busy: true` and
the first assistant delta before releasing the rest of the response. The error
test used a non-OK response and observed an assistant entry containing
`not reachable`.

## Automated verification

Initial route verification after implementation:

```text
npm run typecheck
react-router typegen && tsc
exit 0
```

Full suite before the final navigation-state correction:

```text
npm test
Test Files  90 passed (90)
Tests       679 passed (679)
```

`git diff --check` exited 0, and an explicit scan of the Task 6 files found no
en dash or em dash characters.

Fresh final verification after the navigation-state correction:

```text
npm run typecheck && npm test
react-router typegen && tsc
Test Files  90 passed (90)
Tests       679 passed (679)
exit 0

git diff --check
exit 0
```

## Browser evidence

The local app started successfully at `http://127.0.0.1:5173`. The installed
Playwright package initially lacked its matching Chromium runtime, so the
project's browser runtime was installed without changing repository
dependencies.

The first request correctly redirected an unauthenticated browser to:

```text
http://127.0.0.1:5173/login?next=%2Fclubs%2Fwotf%2Fgarden%2Fagents
```

Because `.dev.vars` has no `DEV_LOGIN_TOKEN`, a disposable local-only user,
club, membership, and signed session were seeded in local D1. They were deleted
after the check.

At a 1440 by 900 viewport, the authenticated list page rendered with:

- the `Agent Workbench` page title and navigation label
- empty owned and shared tables
- the create form with name, description, and submit controls
- existing shell navigation, feedback, and Gardener controls
- `scrollWidth` equal to `clientWidth` at 1440, with no horizontal overflow

A screenshot was captured and visually reviewed. The layout was balanced and
readable. That pass exposed both Idea Garden and Agent Workbench appearing
active because Idea Garden used prefix matching. The desktop and mobile shell
now use exact matching for the Idea Garden root.

The create POST could not be completed in the local runtime. It reached the
existing website origin guard and rendered:

```text
Error
Forbidden
Back to the garden
```

The local page origin was `http://127.0.0.1:5173`, while the checked-in
`WEB_ALLOWED_ORIGINS` binding contains only `https://vibegarden.club`. This is
an environment configuration blocker outside Task 6. Per the parent-agent
instruction, browser work stopped at that point rather than changing the
security configuration. Create, save, and live model streaming therefore were
not browser-verified in this run. The local browser, dev server, and disposable
D1 seed state were cleaned up.

## Concerns

The local browser flow needs an explicit local `WEB_ALLOWED_ORIGINS` binding,
and preferably `DEV_LOGIN_TOKEN`, before the full create, save, and streamed
chat scenario can be exercised. Automated hook, type, and full-suite coverage
is green; the unverified part is the local write path and live model response.
