# Agent package split implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the reusable agent harness and web wire/data adapter into npm workspace packages while keeping Vibe Garden behavior and its public `[[tool:...]]` stream unchanged.

**Architecture:** `@vibegarden/agent-core` owns runtime-neutral events, OpenAI-compatible SSE parsing, ToolSpecs, prompt composition, and the multi-round turn loop. `@vibegarden/agent-web` owns the web marker protocol, delegated query envelopes, and browser-only DuckDB execution; Vibe Garden's React provider and visual components stay in the app because they currently depend on site routes, models, notifications, content cards, and endpoints. The host converts Cloudflare bindings to plain tool configuration at the route boundary.

**Tech stack:** npm 11 workspaces, TypeScript 5.9, React Router 8 Framework Mode, Vite 8, Cloudflare Workers, Vitest 4, DuckDB-WASM.

## Global constraints

- Preserve the existing `[[tool:...]]` wire format and persisted history format byte-for-byte.
- Package source stays TypeScript and is bundled by the consuming Vite app; no separate package build step.
- Core code depends only on fetch and web streams.
- Browser-only DuckDB remains lazy-loaded and must not enter the initial client bundle.
- Do not move React Router route modules or generated `./+types` imports out of `app/`.
- Preserve all existing uncommitted Phase 1 work; use verification checkpoints rather than commits in this workspace.

---

### Task 1: Create the agent-core workspace package

**Files:**
- Create: `packages/agent-core/package.json`
- Create: `packages/agent-core/src/index.ts`
- Move: `app/lib/agent/events.ts` to `packages/agent-core/src/events.ts`
- Move: `app/lib/agent/sse.ts` to `packages/agent-core/src/sse.ts`
- Move: `app/lib/agent/tools.ts` to `packages/agent-core/src/tools.ts`
- Move: `app/lib/agent/run-turn.ts` to `packages/agent-core/src/run-turn.ts`
- Move: `app/lib/agent/__tests__/run-turn.test.ts` to `packages/agent-core/src/__tests__/run-turn.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.cloudflare.json`
- Modify: `vitest.config.ts`
- Modify: agent imports under `app/`

**Interfaces:**
- Produces: package root exports `AgentEvent`, `AgentHistoryMessage`, `AgentTurnConfig`, `ToolCall`, `ToolSpec`, `composeToolsPrompt`, `openAiToolDefinitions`, `readSseRound`, and `startTurn`.
- Consumes: only platform fetch, `Response`, `ReadableStream`, `TextDecoderStream`, and standard TypeScript/JavaScript APIs.

- [x] **Step 1: Point the core test at the intended public package API**

  Replace its `~/lib/agent/*` imports with one package-root import:

  ```ts
  import {
    startTurn,
    type AgentEvent,
    type AgentTurnConfig,
    type ToolSpec,
  } from "@vibegarden/agent-core";
  ```

- [x] **Step 2: Run the focused test and verify the boundary is red**

  Run: `npm test -- packages/agent-core/src/__tests__/run-turn.test.ts app/lib/agent/__tests__/run-turn.test.ts`

  Expected: FAIL because `@vibegarden/agent-core` does not exist yet.

- [x] **Step 3: Add workspace metadata and package exports**

  Add root workspaces and dependency:

  ```json
  "workspaces": ["packages/*"],
  "dependencies": {
    "@vibegarden/agent-core": "*"
  }
  ```

  Create `packages/agent-core/package.json`:

  ```json
  {
    "name": "@vibegarden/agent-core",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "exports": { ".": "./src/index.ts" }
  }
  ```

- [x] **Step 4: Move the core files and expose one public barrel**

  Create `packages/agent-core/src/index.ts`:

  ```ts
  export * from "./events";
  export * from "./run-turn";
  export * from "./sse";
  export * from "./tools";
  ```

  Keep internal relative imports unchanged and update app imports to `@vibegarden/agent-core`.

- [x] **Step 5: Include workspace sources in typecheck and tests, then install links**

  Add `packages/**/*` to `tsconfig.cloudflare.json` and `packages/**/__tests__/**/*.test.{ts,tsx}` to Vitest's include list. Run `npm install` to update the lockfile and create workspace links.

- [x] **Step 6: Verify the core package is green**

  Run: `npm test -- packages/agent-core/src/__tests__/run-turn.test.ts app/lib/__tests__/gardener-tools.test.ts app/lib/__tests__/gardener.test.ts`

  Expected: all focused tests PASS.

---

### Task 2: Create the agent-web workspace package

**Files:**
- Create: `packages/agent-web/package.json`
- Create: `packages/agent-web/src/index.ts`
- Move: `app/lib/query-tool.ts` to `packages/agent-web/src/query.ts`
- Move: `app/lib/tool-notes.ts` to `packages/agent-web/src/markers.ts`
- Move: `app/lib/duckdb.client.ts` to `packages/agent-web/src/duckdb.client.ts`
- Move: `app/lib/__tests__/query-tool.test.ts` to `packages/agent-web/src/__tests__/query.test.ts`
- Move: `app/lib/__tests__/tool-notes.test.ts` to `packages/agent-web/src/__tests__/markers.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: all app imports of query, markers, and DuckDB APIs

**Interfaces:**
- Consumes: `AgentEvent` from `@vibegarden/agent-core` and `@duckdb/duckdb-wasm` from its own dependency list.
- Produces: package root exports query types/helpers and marker helpers; `@vibegarden/agent-web/duckdb` exports `DatasetSource`, `registerDataset`, `dropDataset`, `listDatasets`, and `runQuery`.

- [x] **Step 1: Point query and marker tests at the intended package API**

  Import query and marker APIs from `@vibegarden/agent-web` instead of `~/lib/query-tool` and `~/lib/tool-notes`.

- [x] **Step 2: Run the focused tests and verify the boundary is red**

  Run: `npm test -- app/lib/__tests__/query-tool.test.ts app/lib/__tests__/tool-notes.test.ts`

  Expected: FAIL because `@vibegarden/agent-web` does not exist yet.

- [x] **Step 3: Add package metadata and exports**

  Create `packages/agent-web/package.json`:

  ```json
  {
    "name": "@vibegarden/agent-web",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "exports": {
      ".": "./src/index.ts",
      "./duckdb": "./src/duckdb.client.ts"
    },
    "dependencies": {
      "@duckdb/duckdb-wasm": "^1.33.1-dev57.0",
      "@vibegarden/agent-core": "*"
    }
  }
  ```

  Add `@vibegarden/agent-web: "*"` to the root dependencies and remove the root's direct DuckDB dependency.

- [x] **Step 4: Move the web files and expose stable exports**

  Create `packages/agent-web/src/index.ts`:

  ```ts
  export * from "./markers";
  export * from "./query";
  ```

  Update `markers.ts` to import `AgentEvent` from core and `./query`; update `duckdb.client.ts` to import `./query`.

- [x] **Step 5: Update Vibe Garden consumers and lazy imports**

  Use `@vibegarden/agent-web` for marker/query imports and dynamic `import("@vibegarden/agent-web/duckdb")` for browser execution. Do not statically import the DuckDB subpath from rendered components or routes.

- [x] **Step 6: Install workspace links and verify the web adapter**

  Run: `npm install`

  Run: `npm test -- packages/agent-web/src/__tests__/query.test.ts packages/agent-web/src/__tests__/markers.test.ts app/components/gardener/__tests__/gardener-provider.test.tsx app/components/gardener/__tests__/chat-message.test.tsx`

  Expected: all focused tests PASS.

---

### Task 3: Replace Worker Env parameters with plain host configuration

**Files:**
- Create: `app/lib/gardener-tools-config.server.ts`
- Modify: `app/lib/motherduck.server.ts`
- Modify: `app/lib/gardener-tools.server.ts`
- Modify: `app/routes/api.chat.ts`
- Modify: `app/lib/__tests__/gardener-tools.test.ts`
- Modify: `app/lib/__tests__/gardener.test.ts`

**Interfaces:**
- Produces: `MotherDuckConfig = { token?: string; host?: string; database?: string }`.
- Produces: `GardenerToolsConfig = { freshReads?: MotherDuckConfig }`.
- Produces: `gardenerToolsConfig(env: Env): GardenerToolsConfig` at the host boundary.
- Consumes: Cloudflare `Env` only in the route-side adapter, never in tool factories or MotherDuck query functions.

- [x] **Step 1: Change the tool tests to the plain configuration shape**

  Replace Env-shaped fixtures with:

  ```ts
  const config = {};
  offeredGardenerTools({ freshReads: { token: "token" } }, { queryData: true });
  ```

  Assert that `fresh_reads` is gated by `freshReads.token` and `query_data` remains gated by the per-turn option.

- [x] **Step 2: Run the tool tests and verify the configuration contract is red**

  Run: `npm test -- app/lib/__tests__/gardener-tools.test.ts app/lib/__tests__/gardener.test.ts`

  Expected: FAIL because the current factory still reads `MOTHERDUCK_TOKEN` directly.

- [x] **Step 3: Introduce plain configuration types and host adapter**

  Change `queryFreshReads` to accept `MotherDuckConfig`. Change the tool factories to accept `GardenerToolsConfig`. Add the host adapter in `app/lib/gardener-tools-config.server.ts`:

  ```ts
  export function gardenerToolsConfig(env: Env): GardenerToolsConfig {
    return {
      freshReads: env.MOTHERDUCK_TOKEN
        ? {
            token: env.MOTHERDUCK_TOKEN,
            host: env.MOTHERDUCK_PG_HOST,
            database: env.MOTHERDUCK_DATABASE,
          }
        : undefined,
    };
  }
  ```

  The route creates this once and passes it to `offeredGardenerTools`.

- [x] **Step 4: Verify the plain configuration path**

  Run: `npm test -- app/lib/__tests__/gardener-tools.test.ts app/lib/__tests__/gardener.test.ts app/lib/__tests__/motherduck.test.ts`

  Expected: all focused tests PASS.

---

### Task 4: Verify and document Phase 2

**Files:**
- Modify: `docs/plans/2026-07-17-agent-core-extraction.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the completed workspace packages and plain config boundary.
- Produces: repository instructions that identify package ownership and the next Phase 3 MCP adapter boundary.

- [x] **Step 1: Run structural checks**

  Run: `rg -n "~/lib/agent|\\./agent|~/lib/query-tool|~/lib/tool-notes|~/lib/duckdb.client|MOTHERDUCK_TOKEN" app packages --glob '*.{ts,tsx}'`

  Expected: no legacy agent/query/marker/DuckDB imports; `MOTHERDUCK_TOKEN` appears only in the host config adapter and environment documentation.

- [x] **Step 2: Run complete verification**

  Run: `npm test`

  Expected: all tests PASS.

  Run: `npm run typecheck`

  Expected: exit 0.

  Run: `npm run build`

  Expected: exit 0; the existing large-chunk advisory is non-blocking.

  Run: `git diff --check`

  Expected: exit 0.

- [x] **Step 3: Update project documentation**

  Mark Phase 2 complete in the extraction plan and roadmap. Add package ownership to `CLAUDE.md`: agent-core is runtime-neutral; agent-web owns marker/query/DuckDB web behavior; Gardener-specific prompts, tools, provider, and rendered UI stay in `app/`.

- [x] **Step 4: Review the complete diff**

  Run: `git status --short && git diff --stat && git diff -- package.json packages app docs CLAUDE.md`

  Expected: only the planned package split, imports, configuration adapter, tests, and documentation changes.
