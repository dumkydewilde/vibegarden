# Task 10 report: Workbench tools and delegation round trip

## Status

Implemented the Agent Workbench ToolSpec builders, continuation validation and
model history conversion, and delegated call marker streaming.

## Scope

Changed only the Task 10 implementation, tests, and report:

- `app/lib/agents/tools.server.ts`
- `app/lib/agents/chat-request.ts`
- `app/lib/agents/__tests__/tools.test.ts`
- `app/lib/agents/__tests__/chat-request.test.ts`
- `app/routes/api.agents.$agentId.chat.ts`
- `app/routes/__tests__/api.agents.$agentId.chat.test.ts`
- `.superpowers/sdd/task-10-report.md`

The unrelated existing modification to `.superpowers/sdd/task-6-report.md`
was not changed or staged.

## Delivered behavior

- Builds one delegated ToolSpec for every user-authored tool and preserves the
  raw argument object as its browser payload.
- Adds the delegated `fetch_page` builtin when enabled. Its delegate reuses
  `checkFetchUrl`, accepts only guarded HTTPS URLs, and lets invalid calls fall
  through to an `Error:` tool result.
- Adds delegated `remember` and `recall` builtins when memory is enabled.
  Remembered keys are limited to 80 characters and values to 500 characters.
- Exports `WORKBENCH_MAX_CONTINUATIONS = 5` for the Task 11 client loop without
  implementing that later client behavior here.
- Requires continuation requests to end in a valid data message containing a
  tool name and `CallResultEnvelope`.
- Re-parses and re-caps client envelopes through `parseCallResultEnvelope`
  before model-bound history is assembled.
- Converts continuation data to the exact `Tool result for <tool>:` user line
  and runs assistant content through the existing `toModelText` compaction.
- Offers tools on continuation turns so agents can chain browser-executed work.
- Streams delegated calls through `markerForEvent` on their own terminal line
  with no trailing break.
- Preserves the Task 5 prompt-only request and upstream failure behavior.

## TDD evidence

The Task 10 tests were added before production implementation.

Red run:

```text
npm test -- app/lib/agents
Test Files  2 failed | 3 passed (5)
Tests       1 failed | 57 passed (58)
Failed to resolve import "../tools.server"
Expected WORKBENCH_MAX_CONTINUATIONS to be 5, received undefined
```

Green run after the ToolSpec and chat request implementation:

```text
npm test -- app/lib/agents
Test Files  5 passed (5)
Tests       64 passed (64)
```

The endpoint regression test initially exposed its old `{ definition: {} }`
fixture after tool construction was wired. The fixture was updated to the
validated Task 5 definition shape, and the new continuation and marker case
then passed.

## Final verification

```text
npm test -- app/lib/agents packages
Test Files  10 passed (10)
Tests       116 passed (116)

npm test -- 'app/routes/__tests__/api.agents.$agentId.chat.test.ts'
Test Files  1 passed (1)
Tests       3 passed (3)

npm run typecheck
react-router typegen && tsc
exit 0
```

The focused tests cover enabled and disabled builtin sets, raw user tool
delegation, HTTP fetch refusal through tool mechanics, memory payload caps,
successful and failed continuation history lines, assistant marker compaction,
server-side result re-capping, tools on continuation turns, and terminal call
marker formatting.

## Concerns

The five-call continuation loop is intentionally not implemented in this task.
Task 11 will consume the exported cap and execute delegated calls in the
browser. No Task 10 implementation blocker remains.

## P1 review follow-up

Two review findings were fixed after the initial Task 10 commit.

### Bounded tool-result transport

The original request parser applied the 8,000 character model limit to raw
message transport content before parsing or compacting it. A valid 4,000
character result containing spaces and control characters expands to more than
8,000 characters when JSON escaped, and its call-result marker expands again
when URI encoded.

The parser now keeps the 8,000 character limit for ordinary user and assistant
content. Oversized transport content is accepted only when all of these checks
pass:

- the raw content is no more than 41,000 characters;
- data content parses as a valid, server-recapped continuation envelope, or
  assistant content contains a parsed call-result marker;
- the transformed model content is no more than 8,000 characters.

The 41,000 character ceiling covers the worst case 8x JSON and URI expansion
of one capped 4,000 character tool result, the ordinary model allowance, and a
small envelope allowance. Tool names in continuation data must also match the
AgentDefinition tool-name contract.

The regression uses `" \\0".repeat(2_000)`. Its 4,000 character result produces
a 22,276 character assistant trace and a 14,100 character data body. Request
parsing accepts both, and history conversion produces only model messages below
8,000 characters. Separate assertions keep arbitrary user content at 8,000
characters and reject even compactable markers above the transport ceiling.

### Trusted builtin names

AgentDefinition parsing now reserves `fetch_page`, `remember`, `recall`, and
the future `use_skill` builtin. User tools cannot shadow these trusted specs,
even when a builtin is currently disabled. Existing duplicate-name validation
still applies, and ordinary user tool names remain valid.

### Follow-up TDD evidence

The new regressions failed before implementation:

```text
npm test -- app/lib/agents/__tests__/chat-request.test.ts app/lib/agents/__tests__/contracts.test.ts
Test Files  2 failed (2)
Tests       5 failed | 17 passed (22)
```

The continuation regression failed with the original 8,000 character error.
Each reserved builtin case failed because the contract returned no error.

Final verification:

```text
npm test -- app/lib/agents packages
Test Files  10 passed (10)
Tests       122 passed (122)

npm test -- 'app/routes/__tests__/api.agents.$agentId.chat.test.ts'
Test Files  1 passed (1)
Tests       3 passed (3)

npm run typecheck
react-router typegen && tsc
exit 0
```

No follow-up blocker remains. The transport cap intentionally admits one
worst-case capped result marker plus bounded surrounding content, not arbitrary
expanded history.

## Second P1 review follow-up

The remaining continuation admission findings were fixed with stricter
transport and endpoint checks.

### Exact oversized transport shapes

- Oversized assistant content is accepted only when every non-whitespace line
  is a valid `call` or `callresult` marker. Arbitrary prose cannot use a valid
  marker to enter the expanded transport path.
- Whitespace around oversized trace markers is capped at the ordinary 8,000
  character message allowance.
- Continuation data now requires exact outer `tool` and `envelope` keys.
- Successful envelopes require exactly `status`, `resultText`, `totalChars`,
  and `truncated`. Error envelopes require exactly `status` and `error`.
  Unknown and padding properties are rejected before server-side re-capping.
- Ordinary messages keep the 8,000 character cap. The existing encoded 4,000
  character call result path remains valid under the transport ceiling.
- Input histories are rejected above 120 messages before per-message
  processing. Valid histories continue to retain the newest 30 messages.

### Continuation provenance

After loading the AgentDefinition, the endpoint builds its ToolSpecs and
checks every continuation before model history construction. The data tool
must be in the offered ToolSpec names and match the last call marker in the
immediately preceding assistant message. Unknown and mismatched tools return
HTTP 400 without starting a model turn.

### TDD evidence

The five adversarial regressions failed before the implementation change:

```text
npm test -- app/lib/agents/__tests__/chat-request.test.ts 'app/routes/__tests__/api.agents.$agentId.chat.test.ts'
Test Files  2 failed (2)
Tests       5 failed | 12 passed (17)
```

Final verification after the fix:

```text
npm test -- app/lib/agents packages 'app/routes/__tests__/api.agents.$agentId.chat.test.ts'
Test Files  11 passed (11)
Tests       130 passed (130)

npm run typecheck
react-router typegen && tsc
exit 0
```

The focused regressions cover assistant marker padding, outer and envelope
data padding, bounded input arrays, unknown tools, preceding call mismatches,
and the valid 4,000 character encoded result path.

## Third review follow-up

The remaining marker admission and legacy transport name findings are fixed.

### Exact call marker payloads

- Generic `call` markers now require exactly `version`, `tool`, and `args`.
- `callresult` envelopes now require exactly the keys for their status.
  Successful results require `status`, `resultText`, `totalChars`, and
  `truncated`. Error results require `status` and `error`.
- Large padding properties make both marker kinds plain text, so they cannot
  enter the expanded assistant transport path through lossy decoding.
- Existing valid call and callresult markers still parse and compact.
- Query and attach marker decoders were not changed, preserving the legacy
  marker transport behavior for valid built-in calls.

### Reserved legacy transport names

AgentDefinition user tools can no longer use `query_data` or `attach_data`.
These names join the existing built-in reserved names so user tools cannot be
routed into legacy marker formats that workbench continuation cannot verify.

### TDD evidence

The package and agent regressions failed before implementation:

```text
npm test -- packages/agent-web/src/__tests__/call.test.ts app/lib/agents/__tests__/chat-request.test.ts app/lib/agents/__tests__/contracts.test.ts 'app/routes/__tests__/api.agents.$agentId.chat.test.ts'
Test Files  3 failed | 1 passed (4)
Tests       7 failed | 42 passed (49)
```

The failures covered padded call and callresult marker parsing, oversized
assistant admission, strict ok and error envelopes, and both legacy reserved
names.

Final verification:

```text
npm test -- app/lib/agents packages 'app/routes/__tests__/api.agents.$agentId.chat.test.ts'
Test Files  11 passed (11)
Tests       137 passed (137)

npm run typecheck
react-router typegen && tsc
exit 0
```

## Final protocol grammar follow-up

The expanded assistant and continuation transport now validates the raw wire
grammar before using decoded content to grant the larger transport allowance.

### Canonical assistant traces

- Every oversized call and call-result marker is decoded and rebuilt through
  the same `callNote` or `callResultNote` serializer used by the browser.
- The rebuilt marker must equal the raw marker exactly. Duplicate JSON keys,
  insignificant JSON whitespace, alternate URI encodings, and values changed
  by server-side capping cannot use the expanded allowance.
- Marker order must alternate from call to call result. One assistant trace is
  limited to five pairs, derived from `WORKBENCH_MAX_CONTINUATIONS`.
- Narration is allowed before, between, or after valid markers. All raw bytes
  outside the canonical markers, including separators and surrounding
  whitespace, stay within the ordinary 8,000 character message budget.
- The worst-case encoded 4,000 character result remains valid with an ordinary
  narration prefix.

### Canonical continuation data

Oversized continuation data must equal `JSON.stringify` of its parsed and
server-capped `{ tool, envelope }` value. This rejects duplicate result fields
and JSON whitespace padding while preserving the valid browser-produced
format. The 120-message input bound and endpoint checks for offered and
matching tool names are unchanged.

### TDD evidence

The adversarial regressions failed before implementation:

```text
npm test -- app/lib/agents/__tests__/chat-request.test.ts
Test Files  1 failed (1)
Tests       5 failed | 13 passed (18)
```

The failures covered a narrated worst-case trace, duplicate `args`, duplicate
`resultText`, 9,000 characters of insignificant JSON whitespace, and a
canonical 360-marker flood.

Final verification:

```text
npm test -- app/lib/agents packages 'app/routes/__tests__/api.agents.$agentId.chat.test.ts'
Test Files  11 passed (11)
Tests       142 passed (142)

npm run typecheck
react-router typegen && tsc
exit 0
```
