# Task 5 report: prompt-only Agent Workbench chat endpoint

## Status

Implemented the prompt-only chat endpoint at `POST /clubs/:clubSlug/api/agents/:agentId/chat`.

## Scope

Changed only the Task 5 implementation, test, route registration, and report files:

- `app/lib/agents/chat-request.ts`
- `app/lib/agents/__tests__/chat-request.test.ts`
- `app/routes/api.agents.$agentId.chat.ts`
- `app/routes.ts`
- `.superpowers/sdd/task-5-report.md`

No conversation persistence, tool delegation, agent tool construction, dataset handling, or thread handling was added.

## Request contract

`parseAgentChatRequest` now:

- requires a non-empty string `versionId`
- requires a non-empty `messages` array
- accepts only `user`, `assistant`, and `data` message roles
- requires string content for every message
- rejects any message over 8,000 characters before history trimming
- requires the last message to be a non-empty user message unless `continuation` is true
- accepts only a boolean `continuation` when provided
- trims valid history to the newest 30 messages
- catches hostile property access or iteration and returns a validation error

The parser is pure and has no server imports.

## Endpoint behavior

The route action:

- authenticates with `requireUser`
- resolves club scope with `requireClubContext`
- maps authorization failures through `apiAuthorizationError`
- returns 400 for malformed JSON or an invalid request contract
- loads the requested agent and version through `getAgentForUser` using club and user scope
- returns 404 when the requested agent or authorized version is unavailable
- resolves the club model with the membership preference and no client model override
- reads the club credential through `getClubChatCredential`
- returns 503 without a legacy credential fallback when the club model credential is unavailable
- removes `data` messages before forming `AgentHistoryMessage[]`
- builds the server-controlled prompt with `buildAgentSystemPrompt`
- starts a turn with an empty tool list and the `Vibe Garden Agent Workbench` title
- returns 502 if the initial model request cannot start
- streams only text deltas and the generic midstream error message
- returns `text/plain; charset=utf-8` with `Cache-Control: no-store`

## TDD evidence

Baseline before Task 5 changes:

```text
npm test -- app/lib/agents
Test Files  2 passed (2)
Tests       13 passed (13)
```

Red run after adding the request tests but before implementation:

```text
npm test -- app/lib/agents
FAIL app/lib/agents/__tests__/chat-request.test.ts
Failed to resolve import "../chat-request"
Test Files  1 failed | 2 passed (3)
Tests       13 passed (13)
```

The failure was expected because `chat-request.ts` did not exist yet.

First green attempt identified an invalid trim-test fixture: its generated history ended with an assistant turn and correctly received `The last message must be from the user.` The fixture was corrected to end with a user turn.

Green run after implementation and fixture correction:

```text
npm test -- app/lib/agents
Test Files  3 passed (3)
Tests       19 passed (19)
```

## Verification evidence

```text
npm run typecheck
react-router typegen && tsc
exit 0
```

```text
git diff --check
exit 0
```

An explicit scan of all Task 5 code and test files found no em dash or en dash characters.

## Concerns

None. The continuation field is validated as required by the request interface, but this stage intentionally does not implement continuation envelopes or delegated tools.

## Reviewer P2 follow-up: rejected initial model request

`startTurn` returns `{ ok: false }` for an initial HTTP response failure, but its
initial `fetch` rejection (for example, a network or TLS failure) occurs before
that result exists and rejects the promise. The agent chat route now catches
that rejection and returns the same 502 JSON payload used for `turn.ok ===
false`:

```json
{ "error": "The language model is not reachable right now." }
```

The change is confined to `app/routes/api.agents.$agentId.chat.ts`; agent-core
and the broader chat route are unchanged.

Focused red test before the route fix:

```text
npm test -- app/routes/__tests__/api.agents.$agentId.chat.test.ts
FAIL returns 502 when starting the initial model request rejects
TypeError: network unavailable
```

Verification after the route fix:

```text
npm test -- app/routes/__tests__/api.agents.$agentId.chat.test.ts app/lib/agents
Test Files  4 passed (4)
Tests       20 passed (20)

npm run typecheck
react-router typegen && tsc
exit 0

git diff --check
exit 0
```

## Reviewer P2 correction: keep prompt failures out of the transport boundary

The initial P2 fix caught a rejected `startTurn` call, but the `try` block also
evaluated the `startTurn` configuration. That meant a synchronous
`buildAgentSystemPrompt` failure was incorrectly converted to the same 502
model-unreachable response as a network failure.

`turnConfig` is now constructed before the `try`; the boundary wraps only
`await startTurn(turnConfig, history)`. The existing rejected-transport test is
preserved, and a regression test proves prompt construction failures reject
without calling `startTurn` or becoming a 502 response.

Focused verification:

```text
npm test -- app/routes/__tests__/api.agents.$agentId.chat.test.ts app/lib/agents
Test Files  4 passed (4)
Tests       21 passed (21)

npm run typecheck
react-router typegen && tsc
exit 0

git diff --check
exit 0
```
