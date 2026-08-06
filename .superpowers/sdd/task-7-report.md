# Task 7 report: call and callresult markers

## Status

Implemented the shared Agent Workbench call envelope and marker protocol in
`@vibegarden/agent-web`.

## Scope

Changed only the Task 7 package surface:

- `packages/agent-web/src/call.ts`
- `packages/agent-web/src/markers.ts`
- `packages/agent-web/src/index.ts`
- `packages/agent-web/src/__tests__/call.test.ts`

The existing `query_data` and `attach_data` marker branches remain the special
cases. Every other `delegated-call` event now produces the general call marker.

## Delivered behavior

- Exports `CallRequest`, `CallResultEnvelope`, the 4,000 character result cap,
  and the 1,000 character error cap.
- Caps successful results while preserving their original character count and
  recomputing the truncation flag.
- Defensively parses client envelopes, rejects malformed shapes, re-caps
  oversized result text, and does not trust a client truncation flag.
- Serializes and parses version 1 `call` and `callresult` markers while
  preserving stream order.
- Keeps malformed call markers as ordinary text.
- Adds call and callresult segments to `ToolNoteSegment`.
- Compacts calls to a 300 character argument JSON summary and results to a
  tool-labeled result summary for model-bound history.
- Maps arbitrary non-data delegated tools, including `extract_text`, to call
  markers without changing query or attach behavior.

## TDD evidence

The requested test module was added before any production implementation.

Red run:

```text
npm test -- packages/agent-web
Test Files  1 failed | 3 passed (4)
Tests       9 failed | 34 passed (43)
```

The failures were the expected missing Task 7 APIs such as `capCallResult`,
`parseCallResultEnvelope`, and `callNote`. Existing package tests stayed green.

Green run after implementation:

```text
npm test -- packages/agent-web
Test Files  4 passed (4)
Tests       43 passed (43)
```

The tests cover exact result and error caps, ok and error round trips,
server-side re-capping, malformed envelopes, marker stream order, malformed
marker fallback, one-line history compaction, the 300 character argument cap,
and arbitrary delegated tool serialization.

## Final verification

Fresh verification before commit:

```text
npm run typecheck
react-router typegen && tsc
exit 0

npm test -- packages/agent-web
Test Files  4 passed (4)
Tests       43 passed (43)

npm test
Test Files  91 passed (91)
Tests       689 passed (689)

git diff --check
exit 0
```

An explicit scan found no em dash or en dash characters in the Task 7 code or
tests.

## Self-review

- Re-read the Task 7 brief and checked every requested export and marker kind.
- Confirmed result parsing preserves a legitimate original `totalChars` value
  while deriving `truncated` from the re-capped text instead of trusting the
  client flag.
- Confirmed call decoding requires version 1, a non-empty tool string, and a
  non-array object for arguments.
- Confirmed callresult history compaction tracks the preceding call tool so the
  summary names the arbitrary tool that actually ran.
- Confirmed query and attach marker generation and history compaction are
  unchanged in behavior and remain covered by the package and repository suites.
- Confirmed the commit contains only the four requested package files.

## Concerns

No Task 7 implementation blocker remains. A pre-existing modification to
`.superpowers/sdd/task-6-report.md` remains in the worktree and was not staged or
changed by this task.

## Commit

`3ce6582 Add call/callresult marker pair for workbench tools`

## Reviewer P2 follow-up

`callSummaryLine` now converts every line-breaking whitespace run in error text
to one space before enforcing its existing 200 character summary cap. The
success summary and all envelope caps are unchanged.

The regression test covers LF, CRLF, and Unicode line-separator whitespace,
plus a boundary case where CRLF normalization must happen before capping to
preserve the final visible character.

Verification:

```text
npm test -- packages/agent-web
Test Files  4 passed (4)
Tests       44 passed (44)

npm run typecheck
exit 0

npm test
Test Files  91 passed (91)
Tests       690 passed (690)

git diff --check
exit 0
```
