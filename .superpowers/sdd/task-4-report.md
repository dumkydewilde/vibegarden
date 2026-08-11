# Task 4 report: Agent Workbench prompt assembly

## Scope

Created the prompt assembly module and its focused unit tests:

- `app/lib/agents/prompt.server.ts`
- `app/lib/agents/__tests__/prompt.test.ts`

## TDD evidence

The focused test was written before the production module. The required red
command failed because `../prompt.server` could not be resolved:

```text
npm test -- app/lib/agents/__tests__/prompt.test.ts
Test Files  1 failed
Error: Failed to resolve import "../prompt.server"
```

After adding the assembly function, the same command passed with 3 tests.

## Delivered behavior

- Provides `buildAgentSystemPrompt(definition, clubName, tools)`.
- Places the server-controlled club frame before the builder prompt.
- Includes the builder prompt verbatim, with a clear placeholder when empty.
- Lists each configured skill by name and description for `use_skill`.
- Delegates tool instructions and the no-tools fallback to
  `@vibegarden/agent-core` `composeToolsPrompt`.

## Verification

Passed:

```text
npm test -- app/lib/agents/__tests__/prompt.test.ts
Test Files  1 passed
Tests  3 passed

npm test -- app/lib/agents
Test Files  2 passed
Tests  13 passed

npm run typecheck
react-router typegen && tsc

git diff --check
```

## Self-review

- Re-read the Task 4 brief and verified the exported signature, exact fallback,
  prompt ordering, skills index, and direct `composeToolsPrompt` use.
- Confirmed the builder prompt is added without modification.
- Confirmed the changed code and tests contain no em dash or en dash
  characters.
- Confirmed no database, artifact-security, or unrelated behavior changed.

## Concerns

None.
