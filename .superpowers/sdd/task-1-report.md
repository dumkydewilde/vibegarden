# Task 1 report: Agent definition contracts

## Scope

Created the agent-definition contract module and its focused Vitest suite:

- `app/lib/agents/contracts.ts`
- `app/lib/agents/__tests__/contracts.test.ts`

## TDD evidence

The test file was added before the production module. The required red command,
`npm test -- app/lib/agents`, failed because `../contracts` could not be resolved.

After the implementation was added, the same focused command passed with 8 tests.

## Delivered behavior

- Defines the requested tool, skill, and agent-definition contracts.
- Provides the requested product caps and name expression.
- Validates the Zod schema including version, builtins, names, descriptions,
  parameters, source, and skill content.
- Rejects duplicate names across tools and skills.
- Returns a safe value-or-error result rather than throwing validation errors.
- Provides an empty definition with both built-ins enabled.
- Measures the serialized definition limit with UTF-8 bytes via `TextEncoder`.
  This makes the 64,000-byte cap correct for non-ASCII text.

## Verification

Passed:

```text
npm test -- app/lib/agents
Test Files  1 passed (1)
Tests  8 passed (8)

npm run typecheck
react-router typegen && tsc
```

## Self-review

Checked that the maximum constraints use inclusive schema limits, that the
cross-type duplicate-name check is deliberate, and that the byte-cap path
cannot mistakenly count JavaScript characters instead of UTF-8 bytes. The
focused test suite includes a non-ASCII size test for this boundary.

## Commit

`21a04eb Add agent definition contracts for the workbench`

## Review follow-up: JSON serialization safety and name-length message

### Scope

Addressed only the two Task 1 review findings in the contract module and its
focused test suite:

- `app/lib/agents/contracts.ts`
- `app/lib/agents/__tests__/contracts.test.ts`

### Red evidence

Added a regression test containing `parameters: { count: BigInt(1) }` and ran:

```text
$ npm test -- app/lib/agents
Test Files  1 failed (1)
Tests  1 failed | 8 passed (9)
TypeError: Do not know how to serialize a BigInt
at parseAgentDefinition app/lib/agents/contracts.ts:63:37
```

This demonstrated that `parseAgentDefinition` could throw during its byte-cap
serialization check, instead of preserving its value-or-error return contract.

### Fix

- Wrapped serialization used by the byte-cap check in `try`/`catch` and return
  `definition must contain only JSON serializable values` when it fails.
- Corrected tool and skill name validation messages from `2-40 chars` to
  `1-40 chars`, matching `^[a-z][a-z0-9_]{1,39}$`.

### Green verification

```text
$ npm test -- app/lib/agents
Test Files  1 passed (1)
Tests  9 passed (9)

$ npm run typecheck
> typecheck
> react-router typegen && tsc
```

## Review follow-up: total parsing boundary

### Scope

Addressed the remaining Task 1 P1 in the parser and its focused suite:

- `app/lib/agents/contracts.ts`
- `app/lib/agents/__tests__/contracts.test.ts`
- `.superpowers/sdd/task-1-report.md`

### Red evidence

Added a regression test that passes a `Proxy` around an otherwise valid empty
definition. Its `systemPrompt` getter throws when Zod reads it. Before the fix:

```text
$ npm test -- app/lib/agents
Test Files  1 failed (1)
Tests  1 failed | 9 passed (10)
Error: hostile getter
at Object.get app/lib/agents/__tests__/contracts.test.ts:54:48
at ZodObject.safeParse
at parseAgentDefinition app/lib/agents/contracts.ts:51:35
```

This proved that `definitionSchema.safeParse(raw)` could itself throw for
hostile input, violating `parseAgentDefinition`'s value-or-error contract.

### Fix

- Wrapped the entire schema parse, duplicate-name check, serialization, and
  byte-count path in an outer `try`/`catch`.
- The outer boundary returns the stable, safe readable error
  `definition could not be parsed safely` without inspecting a possibly hostile
  thrown value.
- Retained the nested serialization-specific error for valid schema data that
  cannot be JSON serialized, preserving the prior review fix and its behavior.

### Green verification

```text
$ npm test -- app/lib/agents
Test Files  1 passed (1)
Tests  10 passed (10)

$ npm run typecheck
> typecheck
> react-router typegen && tsc
```
