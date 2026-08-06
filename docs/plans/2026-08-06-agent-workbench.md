# Agent Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A glass-box workbench where club members build, test, and share agents (system prompt, browser-executed JS tools, skills, memory) with every tool call's raw result and model-bound envelope visible.

**Architecture:** Reuses the three existing seams: the `agent-core` delegated-tool turn loop (every workbench tool is a delegated `ToolSpec`), the `agent-web` marker protocol (one new `call`/`callresult` pair), and the usercontent-origin sandbox (a static runner page executes user JS with `connect-src 'none'`, capabilities bridged via postMessage). One new server execution surface: an SSRF-guarded fetch proxy. Spec: `docs/specs/2026-08-06-agent-workbench-design.md`.

**Tech Stack:** React Router 7 (framework mode) on Cloudflare Workers, D1 + drizzle, Tailwind v4 + shadcn/ui, Vitest, `yaml` (new dep, stage 3), zod v4 (already present).

## Global Constraints

- Copy: no em or en dashes anywhere (code comments, UI copy, docs); use a comma or colon.
- The feature is called "Agent Workbench" in all copy and navigation; routes live under `/garden/agents`.
- Path alias `~/*` maps to `app/*`.
- Definition caps (from the spec, enforced in contracts): systemPrompt 8,000 chars; 8 tools; tool name `^[a-z][a-z0-9_]{1,39}$`; tool description 400 chars; tool source 16,000 chars; 8 skills; skill content 4,000 chars; whole definition JSON 64KB.
- Envelope caps: `CALL_RESULT_MAX_CHARS = 4_000` to the model, error 1,000 chars. Full raw results stay browser-held, never persisted or sent to the server.
- Fetch proxy caps: https only, no IP literals/localhost/internal hosts/`*.vibegarden.club`, 1MB body, 10s timeout, 3 redirects, text-ish content types only, 30 requests/min/user (best effort per isolate).
- Tool results follow the house philosophy: return `"Error: ..."` strings to the model rather than throwing, so it can repair.
- Any change to renderer origin, CSP, sandbox attributes, or capability boundaries requires the security gate from `docs/runbooks/artifact-renderer.md` (`npm test -- app/lib/artifacts app/routes/__tests__/artifact-origin.test.ts && npm run test:worker && npm run test:security && npm run typecheck`).
- Timestamps are epoch-second integers (`Math.floor(Date.now() / 1000)`), ids are `<prefix>_<crypto.randomUUID()>` text, matching `app/db/schema.ts` style.
- Update `docs/ROADMAP.md` when a stage lands.

## File map

```
app/lib/agents/
  contracts.ts            definition types, caps, parseAgentDefinition
  repository.server.ts    D1 CRUD for agents + versions
  prompt.server.ts        server frame + skills index + assembled prompt
  tools.server.ts         ToolSpec builders (user tools, fetch_page, use_skill, remember/recall)
  fetch-guard.server.ts   SSRF guards + capped body reader + rate limiter
  yaml.ts                 tool <-> YAML round-trip (client-safe, stage 3)
  __tests__/              vitest for all of the above
app/routes/
  garden.agents.tsx           list + create (inside app-layout garden section)
  garden.agents.$id.tsx       the workbench
  garden.agents.$id.run.tsx   try-it view for shared agents (stage 5)
  api.agents.$agentId.chat.ts chat endpoint (clubs/:clubSlug/api prefix)
  api.fetch-proxy.ts          fetch proxy (clubs/:clubSlug/api prefix)
app/components/workbench/
  definition-editor.tsx   left pane
  tool-editor.tsx         YAML per-tool editor (stage 3)
  trace-chat.tsx          right pane chat + trace cards
  call-card.tsx           tool call + result cards (Raw / Sent to model tabs)
  use-agent-chat.ts       client turn loop with delegation + continuations
  runner.client.ts        sandbox iframe bridge (stage 3)
  memory.client.ts        IndexedDB agent memory (stage 3)
packages/agent-web/src/
  call.ts                 CallResultEnvelope, caps, parse/cap helpers
  markers.ts              call/callresult (+ proposal, stage 4) marker support
workers/renderer.ts       serves the runner page (stage 3)
renderer-assets/agent-runner/  runner page source (stage 3)
app/db/schema.ts          agents + agent_versions tables
```

---

## Stage 1: schema, CRUD, prompt-only agents

### Task 1: Agent definition contracts

**Files:**
- Create: `app/lib/agents/contracts.ts`
- Test: `app/lib/agents/__tests__/contracts.test.ts`

**Interfaces:**
- Consumes: `zod` (v4, already a dependency).
- Produces:
  ```ts
  export type AgentToolDef = { name: string; description: string; parameters: Record<string, unknown>; source: string };
  export type AgentSkillDef = { name: string; description: string; content: string };
  export type AgentDefinition = {
    version: 1;
    systemPrompt: string;
    tools: AgentToolDef[];
    skills: AgentSkillDef[];
    builtins: { fetchPage: boolean; memory: boolean };
  };
  export const DEFINITION_MAX_BYTES = 64_000;
  export const SYSTEM_PROMPT_MAX_CHARS = 8_000;
  export const MAX_TOOLS = 8;
  export const MAX_SKILLS = 8;
  export const TOOL_SOURCE_MAX_CHARS = 16_000;
  export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
  export function parseAgentDefinition(raw: unknown):
    | { value: AgentDefinition; error?: never }
    | { value?: never; error: string };
  export function emptyDefinition(): AgentDefinition; // prompt "", no tools/skills, builtins on
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// app/lib/agents/__tests__/contracts.test.ts
import { describe, expect, it } from "vitest";
import {
  emptyDefinition,
  parseAgentDefinition,
  SYSTEM_PROMPT_MAX_CHARS,
} from "../contracts";

describe("parseAgentDefinition", () => {
  it("accepts a minimal valid definition", () => {
    const result = parseAgentDefinition({
      version: 1,
      systemPrompt: "You are a helpful pirate.",
      tools: [],
      skills: [],
      builtins: { fetchPage: true, memory: false },
    });
    expect(result.error).toBeUndefined();
    expect(result.value?.systemPrompt).toContain("pirate");
  });

  it("accepts a valid tool and rejects a bad tool name", () => {
    const tool = {
      name: "extract_text",
      description: "Pulls readable text out of HTML.",
      parameters: { type: "object", properties: { html: { type: "string" } } },
      source: "return args.html.replace(/<[^>]+>/g, ' ');",
    };
    expect(parseAgentDefinition({ ...emptyDefinition(), tools: [tool] }).value).toBeDefined();
    expect(
      parseAgentDefinition({ ...emptyDefinition(), tools: [{ ...tool, name: "Bad Name" }] }).error,
    ).toMatch(/tool name/i);
  });

  it("rejects duplicate tool names", () => {
    const tool = {
      name: "extract_text",
      description: "d",
      parameters: { type: "object" },
      source: "return 1;",
    };
    expect(
      parseAgentDefinition({ ...emptyDefinition(), tools: [tool, tool] }).error,
    ).toMatch(/duplicate/i);
  });

  it("rejects an oversized system prompt", () => {
    expect(
      parseAgentDefinition({
        ...emptyDefinition(),
        systemPrompt: "x".repeat(SYSTEM_PROMPT_MAX_CHARS + 1),
      }).error,
    ).toMatch(/system prompt/i);
  });

  it("rejects a definition over the total byte cap", () => {
    const big = {
      ...emptyDefinition(),
      tools: Array.from({ length: 5 }, (_, i) => ({
        name: `tool_${i}`,
        description: "d",
        parameters: { type: "object" },
        source: "x".repeat(15_000),
      })),
    };
    expect(parseAgentDefinition(big).error).toMatch(/64/);
  });

  it("rejects non-object and wrong-version input", () => {
    expect(parseAgentDefinition(null).error).toBeDefined();
    expect(parseAgentDefinition({ version: 2 }).error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- app/lib/agents`
Expected: FAIL, cannot resolve `../contracts`.

- [ ] **Step 3: Implement contracts.ts**

```ts
// app/lib/agents/contracts.ts
import { z } from "zod";

/** Caps are product decisions from the workbench spec; keep them in sync there. */
export const DEFINITION_MAX_BYTES = 64_000;
export const SYSTEM_PROMPT_MAX_CHARS = 8_000;
export const MAX_TOOLS = 8;
export const MAX_SKILLS = 8;
export const TOOL_DESCRIPTION_MAX_CHARS = 400;
export const TOOL_SOURCE_MAX_CHARS = 16_000;
export const SKILL_CONTENT_MAX_CHARS = 4_000;
export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;

const toolSchema = z.object({
  name: z.string().regex(TOOL_NAME_RE, "tool name must be snake_case, 2-40 chars"),
  description: z.string().min(1).max(TOOL_DESCRIPTION_MAX_CHARS),
  parameters: z.record(z.string(), z.unknown()),
  source: z.string().min(1).max(TOOL_SOURCE_MAX_CHARS),
});

const skillSchema = z.object({
  name: z.string().regex(TOOL_NAME_RE, "skill name must be snake_case, 2-40 chars"),
  description: z.string().min(1).max(TOOL_DESCRIPTION_MAX_CHARS),
  content: z.string().min(1).max(SKILL_CONTENT_MAX_CHARS),
});

const definitionSchema = z.object({
  version: z.literal(1),
  systemPrompt: z.string().max(SYSTEM_PROMPT_MAX_CHARS, "system prompt too long"),
  tools: z.array(toolSchema).max(MAX_TOOLS),
  skills: z.array(skillSchema).max(MAX_SKILLS),
  builtins: z.object({ fetchPage: z.boolean(), memory: z.boolean() }),
});

export type AgentToolDef = z.infer<typeof toolSchema>;
export type AgentSkillDef = z.infer<typeof skillSchema>;
export type AgentDefinition = z.infer<typeof definitionSchema>;

export function emptyDefinition(): AgentDefinition {
  return {
    version: 1,
    systemPrompt: "",
    tools: [],
    skills: [],
    builtins: { fetchPage: true, memory: true },
  };
}

export function parseAgentDefinition(
  raw: unknown,
): { value: AgentDefinition; error?: never } | { value?: never; error: string } {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: `${first.path.join(".") || "definition"}: ${first.message}` };
  }
  const names = new Set<string>();
  for (const item of [...parsed.data.tools, ...parsed.data.skills]) {
    if (names.has(item.name)) return { error: `duplicate name "${item.name}"` };
    names.add(item.name);
  }
  if (JSON.stringify(parsed.data).length > DEFINITION_MAX_BYTES) {
    return { error: "definition exceeds 64KB; trim tool sources or skills" };
  }
  return { value: parsed.data };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- app/lib/agents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/agents
git commit -m "Add agent definition contracts for the workbench"
```

### Task 2: agents and agent_versions tables

**Files:**
- Modify: `app/db/schema.ts` (append after the artifact tables, before the type exports)
- Create: migration via `npm run db:generate`

**Interfaces:**
- Produces: `agents`, `agentVersions` drizzle tables and `Agent`, `AgentVersion` inferred types, exact columns below. Later tasks import these from `~/db/schema`.

- [ ] **Step 1: Add the tables to schema.ts**

```ts
export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility", { enum: ["private", "club"] })
      .notNull()
      .default("private"),
    // Starts null so a new agent row can exist before its first version.
    latestVersionId: text("latest_version_id").references(
      () => agentVersions.id,
      { onDelete: "set null" },
    ),
    sharedVersionId: text("shared_version_id").references(
      () => agentVersions.id,
      { onDelete: "set null" },
    ),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "agents_visibility_check",
      sql`${table.visibility} in ('private', 'club')`,
    ),
    index("agents_owner_list_idx").on(
      table.clubId,
      table.ownerId,
      table.deletedAt,
      table.updatedAt,
    ),
    index("agents_shared_list_idx").on(
      table.clubId,
      table.visibility,
      table.deletedAt,
      table.updatedAt,
    ),
  ],
);

export const agentVersions = sqliteTable(
  "agent_versions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** Validated AgentDefinition JSON; parse with parseAgentDefinition on read. */
    definition: text("definition").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("agent_versions_agent_idx").on(table.agentId, table.createdAt)],
);
```

And with the other type exports at the bottom of the file:

```ts
export type Agent = typeof agents.$inferSelect;
export type AgentVersion = typeof agentVersions.$inferSelect;
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npm run db:generate` then `npm run db:migrate`
Expected: a new `drizzle/00XX_*.sql` creating both tables; local apply succeeds.

- [ ] **Step 3: Run the migration and type checks**

Run: `npm run test:migrations && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/db/schema.ts drizzle
git commit -m "Add agents and agent_versions tables"
```

### Task 3: Agents repository

**Files:**
- Create: `app/lib/agents/repository.server.ts`
- Test: `app/lib/agents/__tests__/repository.test.ts` (runs under `npm run test:d1`; copy the D1 test harness setup used by the existing artifact repository tests in `app/lib/artifacts/__tests__/`, same describe/beforeEach shape)

**Interfaces:**
- Consumes: `agents`, `agentVersions` from Task 2; `AgentDefinition`, `parseAgentDefinition` from Task 1; `getDb` style `DrizzleD1Database` handles as used across `app/lib/*.server.ts`.
- Produces:
  ```ts
  export type AgentScope = { clubId: string; userId: string };
  export function createAgent(db, scope: AgentScope, input: { name: string; description: string; definition: AgentDefinition }): Promise<{ agent: Agent; version: AgentVersion }>;
  export function saveAgentVersion(db, scope: AgentScope, agentId: string, input: { name: string; description: string; definition: AgentDefinition }): Promise<AgentVersion>; // owner only, bumps latestVersionId + updatedAt
  export function listAgents(db, scope: AgentScope): Promise<{ mine: Agent[]; shared: Agent[] }>; // excludes deleted; shared = visibility 'club', not mine
  export function getAgentForUser(db, scope: AgentScope, agentId: string, versionId?: string): Promise<{ agent: Agent; version: AgentVersion; definition: AgentDefinition } | null>;
    // owner: any version, default latest. Non-owner: only when visibility 'club', only the shared version. null on no access.
  export function deleteAgent(db, scope: AgentScope, agentId: string): Promise<boolean>; // soft delete, owner only
  ```

- [ ] **Step 1: Write failing tests** covering: create then read back (definition round-trips through JSON); saveAgentVersion by a non-owner returns/throws not-authorized; listAgents separates mine vs shared and hides private agents of others; getAgentForUser as non-owner returns the shared version even after the owner saved a newer draft; deleteAgent hides the agent from lists. Use two user ids in one club, inserted via the same fixture helpers the artifact repository tests use.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:d1 -- agents`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement repository.server.ts.** Follow `app/lib/artifacts/repository.server.ts` conventions: plain drizzle queries, `and(eq(...), isNull(agents.deletedAt))` guards, ids as `` `agent_${crypto.randomUUID()}` `` and `` `agentv_${crypto.randomUUID()}` ``, timestamps `Math.floor(Date.now() / 1000)`. `getAgentForUser` parses the stored definition with `parseAgentDefinition` and returns null (logging a console.error) if a stored row fails validation, so a bad historical row cannot crash a request.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:d1 -- agents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/agents
git commit -m "Add agents repository with version pinning"
```

### Task 4: Prompt assembly

**Files:**
- Create: `app/lib/agents/prompt.server.ts`
- Test: `app/lib/agents/__tests__/prompt.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition` (Task 1); `composeToolsPrompt`, `ToolSpec` from `@vibegarden/agent-core`.
- Produces:
  ```ts
  export function buildAgentSystemPrompt(
    definition: AgentDefinition,
    clubName: string,
    tools: ToolSpec[],
  ): string;
  ```

- [ ] **Step 1: Write failing tests**

```ts
// app/lib/agents/__tests__/prompt.test.ts
import { describe, expect, it } from "vitest";
import { emptyDefinition } from "../contracts";
import { buildAgentSystemPrompt } from "../prompt.server";

describe("buildAgentSystemPrompt", () => {
  it("frames the builder prompt and includes it verbatim", () => {
    const prompt = buildAgentSystemPrompt(
      { ...emptyDefinition(), systemPrompt: "Answer only in haiku." },
      "WOTF",
      [],
    );
    expect(prompt).toContain("built by a member of WOTF");
    expect(prompt).toContain("Answer only in haiku.");
    expect(prompt.indexOf("built by")).toBeLessThan(prompt.indexOf("haiku"));
  });

  it("lists skills by name and description", () => {
    const prompt = buildAgentSystemPrompt(
      {
        ...emptyDefinition(),
        skills: [{ name: "summarize", description: "How to summarize pages", content: "..." }],
      },
      "WOTF",
      [],
    );
    expect(prompt).toContain("summarize: How to summarize pages");
  });

  it("says no tools are available when there are none", () => {
    expect(buildAgentSystemPrompt(emptyDefinition(), "WOTF", [])).toContain(
      "no tools",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- app/lib/agents/__tests__/prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// app/lib/agents/prompt.server.ts
import { composeToolsPrompt, type ToolSpec } from "@vibegarden/agent-core";
import type { AgentDefinition } from "./contracts";

/**
 * The server-controlled frame around a builder's prompt. The workbench shows
 * the full assembled prompt, frame included: nothing the model sees is hidden.
 */
export function buildAgentSystemPrompt(
  definition: AgentDefinition,
  clubName: string,
  tools: ToolSpec[],
): string {
  const skillsIndex =
    definition.skills.length > 0
      ? [
          "Skills you can load with the use_skill tool when they seem relevant:",
          ...definition.skills.map((s) => `- ${s.name}: ${s.description}`),
        ].join("\n")
      : null;
  return [
    `You are an agent built by a member of ${clubName}, a group of friends learning to build with AI. Follow the builder's instructions below. Be honest about your limits; when a tool fails, say what happened.`,
    skillsIndex,
    composeToolsPrompt(tools, "You have no tools available; answer from the conversation alone."),
    "Builder's instructions:",
    definition.systemPrompt || "(the builder has not written instructions yet)",
  ]
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 4: Run tests, expect PASS, then commit**

```bash
git add app/lib/agents
git commit -m "Assemble workbench agent system prompts"
```

### Task 5: Chat endpoint, prompt-only

**Files:**
- Create: `app/routes/api.agents.$agentId.chat.ts`
- Create: `app/lib/agents/chat-request.ts` (pure request validation, client-safe)
- Modify: `app/routes.ts:15` (add two routes next to the other club api routes)
- Test: `app/lib/agents/__tests__/chat-request.test.ts`

**Interfaces:**
- Consumes: `startTurn`, `AgentHistoryMessage` from `@vibegarden/agent-core`; `getAgentForUser` (Task 3); `buildAgentSystemPrompt` (Task 4); `resolveClubModel` from `~/lib/models`; `getClubChatCredential` from `~/lib/club-ai.server`; `requireUser`, `requireClubContext`, `apiAuthorizationError` exactly as `app/routes/api.chat.ts:86-96` uses them.
- Produces:
  ```ts
  // chat-request.ts
  export type AgentChatRequest = { messages: { role: "user" | "assistant" | "data"; content: string }[]; versionId: string; continuation?: boolean };
  export function parseAgentChatRequest(raw: unknown): { value: AgentChatRequest } | { error: string };
  export const AGENT_MESSAGE_MAX_CHARS = 8_000;
  export const AGENT_HISTORY_LIMIT = 30;
  ```
  Endpoint: `POST /clubs/:clubSlug/api/agents/:agentId/chat`, body `AgentChatRequest`, response: plain text stream with markers (same content type and no-store headers as `api.chat.ts:327-332`).

- [ ] **Step 1: Write failing tests for `parseAgentChatRequest`**: rejects missing versionId, empty messages, a non-user last message when not a continuation, oversized message content; accepts a valid shape and trims history to the last `AGENT_HISTORY_LIMIT` messages.

- [ ] **Step 2: Run `npm test -- app/lib/agents`, expect FAIL.**

- [ ] **Step 3: Implement `chat-request.ts`** (plain guards, no zod needed: mirror the inline validation style of `api.chat.ts:104-124`, returning `{ error }` strings).

- [ ] **Step 4: Implement the route.** Skeleton, modeled line by line on `api.chat.ts` minus threads, datasets, and continuation handling (stage 2 adds continuations):

```ts
// app/routes/api.agents.$agentId.chat.ts
import type { Route } from "./+types/api.agents.$agentId.chat";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import { apiAuthorizationError } from "~/lib/api-errors";
import { getDb } from "~/lib/db.server";
import { startTurn, type AgentHistoryMessage } from "@vibegarden/agent-core";
import { getAgentForUser } from "~/lib/agents/repository.server";
import { buildAgentSystemPrompt } from "~/lib/agents/prompt.server";
import { parseAgentChatRequest } from "~/lib/agents/chat-request";
import { resolveClubModel } from "~/lib/models";
import { getClubChatCredential } from "~/lib/club-ai.server";

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  let user, club;
  try {
    user = await requireUser(env, request);
    club = await requireClubContext(env, request, params.clubSlug ?? "");
  } catch (error) {
    return apiAuthorizationError(error);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parseAgentChatRequest(raw);
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
  const body = parsed.value;

  const db = getDb(env);
  const loaded = await getAgentForUser(
    db,
    { clubId: club.club.id, userId: user.id },
    params.agentId ?? "",
    body.versionId,
  );
  if (!loaded) return Response.json({ error: "Agent not found." }, { status: 404 });

  const model = resolveClubModel(club.club.modelPolicy, undefined, club.membership?.modelPref);
  let apiKey: string;
  try {
    apiKey = await getClubChatCredential(env, club.club.id);
  } catch {
    return Response.json({ error: "The model is not ready for this club yet." }, { status: 503 });
  }

  const tools = []; // stage 2 wires agentToolSpecs(loaded.definition, ...) here
  const history: AgentHistoryMessage[] = body.messages
    .filter((m) => m.role !== "data")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const turn = await startTurn(
    {
      apiKey,
      model: model.id,
      systemPrompt: buildAgentSystemPrompt(loaded.definition, club.club.name, tools),
      tools,
      maxToolRounds: 3,
      headers: { "X-Title": "Vibe Garden Agent Workbench" },
    },
    history,
  );
  if (!turn.ok) {
    return Response.json({ error: "The language model is not reachable right now." }, { status: 502 });
  }
  const textStream = new ReadableStream<string>({
    async start(controller) {
      for await (const event of turn.events) {
        if (event.type === "text") controller.enqueue(event.delta);
        if (event.type === "error") controller.enqueue("\n\nSomething went wrong on my end. Try again?");
      }
      controller.close();
    },
  }).pipeThrough(new TextEncoderStream());
  return new Response(textStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
```

Register in `app/routes.ts` next to the existing club api routes (outside the app-layout children, matching `api.chat.ts`):

```ts
route("clubs/:clubSlug/api/agents/:agentId/chat", "routes/api.agents.$agentId.chat.ts"),
```

- [ ] **Step 5: Run `npm test -- app/lib/agents && npm run typecheck`, expect PASS, commit**

```bash
git add app/routes.ts app/routes/api.agents.$agentId.chat.ts app/lib/agents
git commit -m "Add prompt-only agent chat endpoint"
```

### Task 6: Workbench routes and minimal UI

**Files:**
- Create: `app/routes/garden.agents.tsx` (list + create form)
- Create: `app/routes/garden.agents.$id.tsx` (workbench: prompt editor + plain chat)
- Create: `app/components/workbench/use-agent-chat.ts`
- Modify: `app/routes.ts` (two child routes under the app-layout garden section, after the modules route)
- Modify: `app/lib/nav.ts` (add "Agent Workbench" to the garden navigation, matching how artifacts/gallery entries are declared there)
- Test: `app/components/workbench/__tests__/use-agent-chat.test.ts` (jsdom, mock fetch)

**Interfaces:**
- Consumes: repository (Task 3), contracts (Task 1), endpoint (Task 5), shadcn/ui primitives from `app/components/ui`.
- Produces:
  ```ts
  // use-agent-chat.ts
  export type ChatEntry = { role: "user" | "assistant"; content: string };
  export function useAgentChat(opts: { clubSlug: string; agentId: string; versionId: string }): {
    entries: ChatEntry[];
    send: (text: string) => Promise<void>;
    busy: boolean;
    reset: () => void;
  };
  ```
  Route loaders return `{ mine, shared }` (list) and `{ agent, version, definition }` (workbench); the workbench action handles `intent=save` (validates via `parseAgentDefinition`, calls `saveAgentVersion`) and `intent=create` on the list route.

- [ ] **Step 1: Write the failing hook test**: mock `fetch` returning a two-chunk text stream; assert `send` appends a user entry, streams the assistant entry incrementally, and flips `busy`. Assert a non-ok response produces an assistant entry containing "not reachable".

- [ ] **Step 2: Run `npm test -- app/components/workbench`, expect FAIL.**

- [ ] **Step 3: Implement the hook** (plain `fetch` + `response.body.getReader()` + `TextDecoder`, appending deltas to the last assistant entry; state via `useState`, no external deps).

- [ ] **Step 4: Implement the two routes.** List: table of my agents and shared agents (name, description, updated date), a create form (name + description) posting `intent=create`, redirect to the workbench on success. Workbench v1: two-column layout (`grid gap-6 lg:grid-cols-2`); left column a `<textarea>` bound to `definition.systemPrompt` plus name/description inputs and a Save button posting the full definition JSON as a hidden field; right column the chat (input + entries list) using `useAgentChat` with the loaded `version.id`, plus a read-only "What the model sees" `<details>` block rendering `buildAgentSystemPrompt` output passed from the loader. Keep styling to existing tokens; serif headings come free from the app shell. Register routes:

```ts
route("garden/agents", "routes/garden.agents.tsx"),
route("garden/agents/:id", "routes/garden.agents.$id.tsx"),
```

- [ ] **Step 5: Verify end to end.** Run `npm run typecheck && npm test`, then use the `verify` skill flow (login, create an agent, set a persona prompt, chat, see streamed replies). Expected: a prompt-only agent works in the workbench.

- [ ] **Step 6: Commit**

```bash
git add app/routes.ts app/routes/garden.agents.tsx app/routes/garden.agents.$id.tsx app/components/workbench app/lib/nav.ts
git commit -m "Add Agent Workbench list and prompt-only workbench UI"
```

---

## Stage 2: fetch_page and the trace view

### Task 7: call/callresult markers and envelope

**Files:**
- Create: `packages/agent-web/src/call.ts`
- Modify: `packages/agent-web/src/markers.ts` (new segment kinds + notes + `toModelText` compaction)
- Modify: `packages/agent-web/src/index.ts` (export the new module)
- Test: `packages/agent-web/src/__tests__/call.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // call.ts
  export const CALL_RESULT_MAX_CHARS = 4_000;
  export const CALL_ERROR_MAX_CHARS = 1_000;
  export type CallRequest = { tool: string; args: Record<string, unknown> };
  export type CallResultEnvelope =
    | { status: "ok"; resultText: string; totalChars: number; truncated: boolean }
    | { status: "error"; error: string };
  export function capCallResult(raw: string): Extract<CallResultEnvelope, { status: "ok" }>;
  export function callErrorEnvelope(message: string): Extract<CallResultEnvelope, { status: "error" }>;
  export function parseCallResultEnvelope(raw: string): CallResultEnvelope | null; // defensive, re-caps
  export function callSummaryLine(tool: string, envelope: CallResultEnvelope): string; // for model-bound history
  ```
  ```ts
  // markers.ts additions
  export function callNote(payload: { tool: string; args: Record<string, unknown> }): string;      // [[tool:call:...]]
  export function callResultNote(result: CallResultEnvelope): string;                              // [[tool:callresult:...]]
  // ToolNoteSegment union gains:
  //   | { type: "call"; tool: string; args: Record<string, unknown> }
  //   | { type: "callresult"; result: CallResultEnvelope }
  ```
  `markerForEvent` maps any `delegated-call` event whose tool is not `query_data`/`attach_data` to `callNote({ tool: event.tool, args: event.payload as Record<string, unknown> })`. `toModelText` compacts a call segment to `[ran <tool>: <args JSON, 300 chars>]` and a callresult segment to `callSummaryLine` output.

- [ ] **Step 1: Write failing tests**: `capCallResult` truncates at 4,000 chars and reports `totalChars`/`truncated`; `parseCallResultEnvelope` round-trips ok and error envelopes, re-caps an oversized client payload, returns null on garbage; `callNote`/`splitToolNotes` round-trip a call and a callresult segment in stream order; `toModelText` compacts both to one-liners; `markerForEvent` serializes a `delegated-call` for tool `extract_text`.

- [ ] **Step 2: Run `npm test -- packages/agent-web`, expect FAIL.**

- [ ] **Step 3: Implement.** `call.ts` mirrors `query.ts` conventions (slice caps, defensive JSON parse). In `markers.ts`, add `CALL_LINE`/`CALL_RESULT_LINE` regexes and decode branches in `splitToolNotes` following the existing query pattern exactly, and extend the `markerForEvent` delegated-call branch:

```ts
// markers.ts, inside case "delegated-call", after the attach_data branch:
const args = event.payload as Record<string, unknown>;
return callNote({ tool: event.tool, args: args ?? {} });
```

- [ ] **Step 4: Run `npm test -- packages/agent-web`, expect PASS. Also `npm test` to confirm no gardener regressions (query/attach behavior unchanged).**

- [ ] **Step 5: Commit**

```bash
git add packages/agent-web
git commit -m "Add call/callresult marker pair for workbench tools"
```

### Task 8: Fetch guards

**Files:**
- Create: `app/lib/agents/fetch-guard.server.ts`
- Test: `app/lib/agents/__tests__/fetch-guard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const FETCH_BODY_MAX_BYTES = 1_000_000;
  export const FETCH_TIMEOUT_MS = 10_000;
  export const FETCH_MAX_REDIRECTS = 3;
  export function checkFetchUrl(raw: string): { url: URL; error?: never } | { url?: never; error: string };
  export function isAllowedContentType(contentType: string | null): boolean;
  export function readCappedText(response: Response, maxBytes?: number): Promise<{ body: string; totalChars: number; truncated: boolean }>;
  export type ProxyResult =
    | { ok: true; status: number; contentType: string; body: string; totalChars: number; truncated: boolean }
    | { ok: false; error: string };
  export function proxyFetch(raw: string, fetchImpl?: typeof fetch): Promise<ProxyResult>; // manual redirect loop, re-checks every hop
  ```

- [ ] **Step 1: Write failing tests.** The SSRF matrix as table-driven cases for `checkFetchUrl`:

```ts
const blocked = [
  "http://example.com/a",            // not https
  "https://127.0.0.1/x",             // IP literal
  "https://[::1]/x",                 // IPv6 literal
  "https://192.168.1.10/x",          // IP literal
  "https://localhost/x",
  "https://foo.local/x",
  "https://metadata.internal/x",
  "https://usercontent.vibegarden.club/x",
  "https://vibegarden.club/x",
  "ftp://example.com/x",
  "not a url",
];
const allowed = ["https://example.com/page", "https://api.github.com/repos"];
```

`isAllowedContentType`: allows `text/html; charset=utf-8`, `application/json`, `application/xml`, `application/rss+xml`; blocks `image/png`, `application/octet-stream`, null. `readCappedText`: a streamed body over the cap comes back truncated with correct `totalChars` semantics (chars read before the cap). `proxyFetch` with an injected `fetchImpl`: follows one redirect to an allowed host; refuses a redirect to `https://127.0.0.1/`; gives a clear error after `FETCH_MAX_REDIRECTS` hops; times out via AbortSignal (fake fetch that never resolves except on abort).

- [ ] **Step 2: Run `npm test -- app/lib/agents/__tests__/fetch-guard.test.ts`, expect FAIL.**

- [ ] **Step 3: Implement.** `checkFetchUrl`: `new URL`, protocol must be `https:`, hostname must not match `/^\d{1,3}(\.\d{1,3}){3}$/`, must not contain `[` (IPv6), must not be `localhost`, must not end with `.local`, `.internal`, or `.vibegarden.club`, and must not equal `vibegarden.club`. `proxyFetch`: loop up to `FETCH_MAX_REDIRECTS + 1` requests with `redirect: "manual"`, re-running `checkFetchUrl` on every `location` header, `AbortSignal.timeout(FETCH_TIMEOUT_MS)` shared across hops, then content-type check, then `readCappedText` (read the body reader chunk by chunk, stop and `cancel()` past the byte cap). Every refusal returns `{ ok: false, error }` with a human-readable reason (these render verbatim in the trace, they are teaching copy: "That address points at a private network, which the fetch tool does not reach.").

- [ ] **Step 4: Run tests, expect PASS, commit**

```bash
git add app/lib/agents
git commit -m "Add SSRF-guarded fetch helpers for the workbench proxy"
```

### Task 9: Fetch proxy endpoint

**Files:**
- Create: `app/routes/api.fetch-proxy.ts`
- Modify: `app/routes.ts` (register `clubs/:clubSlug/api/fetch-proxy`)
- Test: rate limiter unit test appended to `app/lib/agents/__tests__/fetch-guard.test.ts`

**Interfaces:**
- Consumes: Task 8 helpers; `requireUser`/`requireClubContext`/`apiAuthorizationError`.
- Produces: `POST /clubs/:clubSlug/api/fetch-proxy`, body `{ url: string }`, 200 with `ProxyResult`-shaped JSON (`{ status, contentType, body, totalChars, truncated }` on ok, `{ error }` with status 400/429 otherwise). Also, in fetch-guard.server.ts:
  ```ts
  export const FETCH_RATE_LIMIT = 30; // per user per minute, best effort per isolate
  export function rateLimiter(limit?: number, windowMs?: number): { take: (key: string, now?: number) => boolean };
  ```

- [ ] **Step 1: Write failing rate limiter tests**: 30 takes pass, the 31st fails, a take one window later passes again (drive time with the `now` parameter).

- [ ] **Step 2: Run, expect FAIL. Implement `rateLimiter`** (Map of key to timestamps, prune on take; module-level singleton in the route; a comment noting it is per isolate and best effort, real protection is the byte/time caps and club credentials).

- [ ] **Step 3: Implement the route**: auth exactly like Task 5, parse `{ url }`, `limiter.take(user.id)` else 429 `{ error: "Too many fetches this minute. Give it a moment." }`, then `proxyFetch(url)` and `Response.json`. No streaming: the capped body fits in one JSON response.

- [ ] **Step 4: Run `npm test -- app/lib/agents && npm run typecheck`, expect PASS, commit**

```bash
git add app/routes.ts app/routes/api.fetch-proxy.ts app/lib/agents
git commit -m "Add authenticated fetch proxy for workbench agents"
```

### Task 10: Workbench ToolSpecs and delegation round-trip

**Files:**
- Create: `app/lib/agents/tools.server.ts`
- Modify: `app/routes/api.agents.$agentId.chat.ts` (offer tools, emit markers, accept continuations)
- Modify: `app/lib/agents/chat-request.ts` (continuation shape)
- Test: `app/lib/agents/__tests__/tools.test.ts`

**Interfaces:**
- Consumes: `ToolSpec` from agent-core; `CallResultEnvelope`, `parseCallResultEnvelope`, `callSummaryLine`, `callNote`, `callResultNote`, `markerForEvent` from agent-web; `AgentDefinition`.
- Produces:
  ```ts
  // tools.server.ts
  export function agentToolSpecs(definition: AgentDefinition): ToolSpec[];
  // - one delegated spec per definition tool: delegate returns the raw args (any object is valid; the tool's own JS decides), noteFor returns null (the call marker is the trace)
  // - fetch_page when builtins.fetchPage: parameters { url: string }, delegate validates https URL shape (reuse checkFetchUrl), execute returns "Error: ..." for invalid urls
  // - remember/recall when builtins.memory: delegate returns { op: "remember", key, value } / { op: "recall" }; keys and values length-checked (key 80, value 500 chars)
  // stage 4 adds use_skill here
  ```
  Chat request gains `continuation?: boolean`; when true the last message must be `role: "data"` with a JSON body `{ tool: string, envelope: CallResultEnvelope }` (validated and re-capped server-side via `parseCallResultEnvelope`). Model-bound history: `data` messages become `role: "user"` content `` `Tool result for ${tool}:\n${envelope.status === "ok" ? envelope.resultText : `Error: ${envelope.error}`}` `` and assistant messages pass through `toModelText`. Continuations keep tools offered (agents chain fetch then extract; that is the point), client caps the chain at `WORKBENCH_MAX_CONTINUATIONS = 5` (exported from `chat-request.ts`).

- [ ] **Step 1: Write failing tests**: `agentToolSpecs` produces specs named after the definition tools plus builtins when toggled on; `delegationFor` (from agent-core) on a user tool call returns the args payload; the fetch_page spec's delegate rejects `http://` and returns null so execute answers with an "Error:" string; a continuation data message renders into the model history line shown above (test via an exported `historyForModel(messages)` helper in `chat-request.ts`).

- [ ] **Step 2: Run `npm test -- app/lib/agents`, expect FAIL. Implement both files.**

- [ ] **Step 3: Wire the endpoint.** Diff against Task 5's skeleton: build `const tools = agentToolSpecs(loaded.definition)`; stream `delegated-call` events as markers exactly like `api.chat.ts:284-288` (`markerForEvent(event)` then emit on its own line, no trailing break: the turn ends there); validate continuations per the produces-block; use `historyForModel` for model-bound history. On a continuation the turn keeps tools unless the chain limit was reached client-side.

- [ ] **Step 4: Run `npm test -- app/lib/agents packages && npm run typecheck`, expect PASS, commit**

```bash
git add app/lib/agents app/routes/api.agents.$agentId.chat.ts
git commit -m "Offer delegated workbench tools and handle continuations"
```

### Task 11: Trace chat UI

**Files:**
- Create: `app/components/workbench/call-card.tsx`
- Create: `app/components/workbench/trace-chat.tsx`
- Modify: `app/components/workbench/use-agent-chat.ts` (delegation loop)
- Modify: `app/routes/garden.agents.$id.tsx` (swap plain chat for trace-chat)
- Test: `app/components/workbench/__tests__/call-card.test.tsx`, extend `use-agent-chat.test.ts`

**Interfaces:**
- Consumes: `splitToolNotes`, call/callresult segments, `capCallResult`, `callErrorEnvelope` from agent-web; fetch proxy endpoint (Task 9).
- Produces:
  ```ts
  // use-agent-chat.ts additions
  export type ToolExecutor = (call: { tool: string; args: Record<string, unknown> }) =>
    Promise<{ raw: string; envelope: CallResultEnvelope } | { raw?: never; envelope: CallResultEnvelope }>;
  // hook option: executors: Record<string, ToolExecutor> keyed by tool name, plus a fallback executor
  // hook return gains: rawResults: Map<number, string>  (entry index -> full raw payload, browser-held only)
  ```
  The hook's send loop: after a response stream ends, `splitToolNotes` the assistant entry; if the last segment is a `call`, run the executor, append `callResultNote(envelope)` to the entry text, store `raw` in `rawResults`, and POST a continuation (`{ tool, envelope }` as the data message) unless `WORKBENCH_MAX_CONTINUATIONS` is reached (then append a visible note line: "Stopped after 5 tool calls in a row.").
  `call-card.tsx` renders a call segment (tool name, args as pretty JSON in a `<pre>`) and a callresult segment as a card with two tab buttons, **Raw** and **Sent to model**: Raw shows the browser-held full payload (monospace, `max-h-96 overflow-auto`, header "212,340 chars fetched, the model saw 4,000" computed from `totalChars` vs `resultText.length`); Sent to model shows `envelope.resultText` or the error verbatim.

- [ ] **Step 1: Write failing card tests**: renders tool name and args; Raw tab shows full text and the chars-fetched header; Sent-to-model tab shows the capped text; error envelope renders the error prominently.

- [ ] **Step 2: Extend the hook test**: a mocked stream ending in a `[[tool:call:...]]` marker for `fetch_page` triggers the registered executor, then a second fetch (the continuation POST) whose mocked reply streams narration; assert the final entry contains the callresult marker and narration, and `rawResults` holds the raw body.

- [ ] **Step 3: Run `npm test -- app/components/workbench`, expect FAIL. Implement.** The `fetch_page` executor lives in `garden.agents.$id.tsx`: POST the proxy, on ok `raw = body`, `envelope = capCallResult(body)`; on error `envelope = callErrorEnvelope(error)`. The fallback executor returns `callErrorEnvelope("No executor for this tool yet.")` (stage 3 replaces it with the runner). `trace-chat.tsx` maps entries through `splitToolNotes` and renders text segments as markdown (reuse `react-markdown` as `chat-message.tsx` does) and call/callresult segments as `call-card.tsx`.

- [ ] **Step 4: Run `npm test -- app/components/workbench && npm run typecheck`, expect PASS.**

- [ ] **Step 5: Verify the lesson end to end** with the `verify` skill: enable fetch_page, ask the agent to fetch a real page, watch the call card, the Raw tab full of HTML, the Sent-to-model tab capped at 4,000 chars, and the narration continuation. Update `docs/ROADMAP.md` (stages 1-2 of the workbench landed).

- [ ] **Step 6: Commit**

```bash
git add app/components/workbench app/routes/garden.agents.$id.tsx docs/ROADMAP.md
git commit -m "Render the workbench trace with raw and sent-to-model views"
```

---

## Stage 3: sandbox runner, user JS tools, memory

### Task 12: The runner page on the usercontent origin

**Files:**
- Create: `workers/agent-runner.ts` (runner HTML + script as string constants, plus the request handler)
- Modify: `workers/renderer.ts` (route `GET /agent-runner` to the new handler; read the file first, follow its existing dispatch style)
- Test: `test/security/agent-runner.spec.ts` (extends the existing `npm run test:security` harness; copy the fixture/origin setup from the existing specs in `test/security/`)

This task changes the renderer boundary: run the full security gate from Global Constraints before committing, and add an "Agent runner" section to `docs/runbooks/artifact-renderer.md` documenting the page, its CSP, and that changes to it require the gate.

**Interfaces:**
- Produces: `GET https://usercontent.vibegarden.club/agent-runner` returns the runner page with headers `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'` and `X-Frame-Options` absent (it must be frameable by the website, CSP `frame-ancestors` set to the website origin the renderer already knows). The page speaks this postMessage protocol (window messages, no origin secrets: the iframe is opaque-origin so the parent uses `targetOrigin: "*"` and validates message shape):
  ```ts
  // parent -> runner
  type ExecuteMsg = { type: "execute"; id: string; source: string; args: Record<string, unknown> };
  type HostResultMsg = { type: "host-result"; callId: string; ok: boolean; value?: unknown; error?: string };
  // runner -> parent
  type ResultMsg = { type: "result"; id: string; ok: boolean; value?: string; error?: string; logs: string[] };
  type HostMsg = { type: "host"; id: string; callId: string; method: "fetchPage" | "memoryGet" | "memorySet" | "memoryList"; params: unknown[] };
  type ReadyMsg = { type: "ready" };
  ```
  User source is compiled as `new Function("args", "env", '"use strict"; return (async () => {\n' + source + "\n})();")`. `env` provides `fetchPage(url)`, `memory.get(key)`, `memory.set(key, value)`, `memory.list()` (each bridged as a HostMsg awaiting its HostResultMsg) and `log(line)` (appends to `logs`, capped at 50 lines of 500 chars). The return value is `JSON.stringify`ed by the runner (undefined becomes `"null"`); serialization failure is an error result. One execution at a time; a second ExecuteMsg while busy returns an error result for the new id.

- [ ] **Step 1: Write the failing security test.** Assertions: the page loads inside `<iframe sandbox="allow-scripts">`; an executed tool whose source is `return await fetch("https://example.com").then(r => r.status)` produces an error result (connect-src blocks it); source `return window.parent.document.title` produces an error result (opaque origin); source `return document.cookie` returns an empty string; source `return args.a + args.b` with `{a: 2, b: 3}` returns `"5"`; `env.log("hi")` shows up in `logs`. Drive the iframe from a fixture page via `page.evaluate` postMessage round-trips.

- [ ] **Step 2: Run `npm run test:security -- agent-runner`, expect FAIL (404).**

- [ ] **Step 3: Implement the runner.** The script body (inside the HTML string):

```js
"use strict";
let busy = false;
const pending = new Map(); // callId -> {resolve, reject}
function hostCall(id, method, params) {
  const callId = `${id}:${pending.size}:${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject });
    window.parent.postMessage({ type: "host", id, callId, method, params }, "*");
  });
}
window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (msg && msg.type === "host-result" && pending.has(msg.callId)) {
    const p = pending.get(msg.callId);
    pending.delete(msg.callId);
    msg.ok ? p.resolve(msg.value) : p.reject(new Error(msg.error || "host call failed"));
    return;
  }
  if (!msg || msg.type !== "execute") return;
  const { id, source, args } = msg;
  const logs = [];
  if (busy) {
    window.parent.postMessage({ type: "result", id, ok: false, error: "Runner is busy with another call.", logs }, "*");
    return;
  }
  busy = true;
  const env = {
    fetchPage: (url) => hostCall(id, "fetchPage", [url]),
    memory: {
      get: (key) => hostCall(id, "memoryGet", [key]),
      set: (key, value) => hostCall(id, "memorySet", [key, value]),
      list: () => hostCall(id, "memoryList", []),
    },
    log: (line) => { if (logs.length < 50) logs.push(String(line).slice(0, 500)); },
  };
  try {
    const fn = new Function("args", "env", '"use strict"; return (async () => {\n' + source + "\n})();");
    const value = await fn(args, env);
    window.parent.postMessage({ type: "result", id, ok: true, value: JSON.stringify(value ?? null), logs }, "*");
  } catch (e) {
    window.parent.postMessage({ type: "result", id, ok: false, error: e && e.message ? String(e.message).slice(0, 1000) : String(e), logs }, "*");
  } finally {
    busy = false;
  }
});
window.parent.postMessage({ type: "ready" }, "*");
```

The handler in `workers/agent-runner.ts` returns this page with the CSP above plus `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; `workers/renderer.ts` dispatches `GET /agent-runner` to it before its R2 logic.

- [ ] **Step 4: Run the full security gate** (`npm test -- app/lib/artifacts app/routes/__tests__/artifact-origin.test.ts && npm run test:worker && npm run test:security && npm run typecheck`), expect PASS. Update the runbook section.

- [ ] **Step 5: Commit**

```bash
git add workers test/security docs/runbooks/artifact-renderer.md
git commit -m "Serve the sandboxed agent tool runner on the usercontent origin"
```

### Task 13: Runner client bridge

**Files:**
- Create: `app/components/workbench/runner.client.ts`
- Test: `app/components/workbench/__tests__/runner.client.test.ts` (jsdom: fake the iframe by intercepting `postMessage`, or factor the message router into a pure function and test that; prefer the pure-router factoring)

**Interfaces:**
- Consumes: the Task 12 message protocol; the runner origin from an env-derived prop (`RENDERER_ORIGIN` is already known to the app for artifact frames; pass it via the route loader the same way `artifact-frame.tsx` gets its capability URL host).
- Produces:
  ```ts
  export type HostHandlers = {
    fetchPage: (url: string) => Promise<unknown>;
    memoryGet: (key: string) => Promise<unknown>;
    memorySet: (key: string, value: string) => Promise<unknown>;
    memoryList: () => Promise<unknown>;
  };
  export const RUN_TIMEOUT_MS = 10_000;
  export function createRunner(opts: { runnerUrl: string; host: HostHandlers }): {
    run: (source: string, args: Record<string, unknown>) => Promise<
      { ok: true; value: string; logs: string[] } | { ok: false; error: string; logs: string[] }
    >;
    dispose: () => void;
  };
  ```
  `createRunner` lazily appends a hidden `<iframe sandbox="allow-scripts" src={runnerUrl}>`, waits for `ready`, serializes runs (one at a time), enforces `RUN_TIMEOUT_MS` per run by removing and recreating the iframe on timeout (result: `{ ok: false, error: "Tool timed out after 10 seconds." }`), routes `host` messages to `host` handlers and posts `host-result` back, and ignores messages that do not match the protocol shapes.

- [ ] **Step 1: Write failing tests for the message router**: an execute lifecycle resolves with the result message; a host message calls the right handler and posts host-result (ok and error paths); a timeout rejects into the error shape and later messages for the dead id are ignored; malformed messages are ignored.

- [ ] **Step 2: Run `npm test -- app/components/workbench`, expect FAIL. Implement.**

- [ ] **Step 3: Run tests, expect PASS, commit**

```bash
git add app/components/workbench
git commit -m "Bridge the workbench to the sandboxed tool runner"
```

### Task 14: Memory store and executor wiring

**Files:**
- Create: `app/components/workbench/memory.client.ts`
- Modify: `app/routes/garden.agents.$id.tsx` (register executors: user tools via runner, remember/recall via memory)
- Test: `app/components/workbench/__tests__/memory.client.test.ts` (jsdom has IndexedDB via `fake-indexeddb` only if already available; otherwise factor the store behind an in-memory fallback and test the fallback plus the envelope shaping)

**Interfaces:**
- Consumes: runner (Task 13), `capCallResult`/`callErrorEnvelope` (Task 7), tools wiring (Tasks 10-11).
- Produces:
  ```ts
  // memory.client.ts
  export const MEMORY_MAX_ENTRIES = 100;
  export const MEMORY_VALUE_MAX_CHARS = 500;
  export function agentMemory(agentId: string, userId: string): {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>; // evicts oldest past MAX_ENTRIES
    list: () => Promise<{ key: string; value: string }[]>; // up to 20, newest first
  };
  ```
  Executor wiring in the workbench route:
  - user tool: look the tool up in the loaded version's definition by name (the version the chat was started with, not editor state), `runner.run(tool.source, args)`; ok result becomes `{ raw: value + logs joined, envelope: capCallResult(value) }` with logs attached to the card; error becomes `callErrorEnvelope(error)`.
  - `remember`: `memory.set(args.key, args.value)` then envelope `capCallResult("Remembered " + key + ".")`.
  - `recall`: `memory.list()` rendered as `key: value` lines, enveloped with `capCallResult`.
  - `fetch_page` from the runner's `env.fetchPage` host handler reuses the same proxy POST as the direct executor (one function, exported from the route module scope).

- [ ] **Step 1: Write failing memory tests** (set/get round-trip, list order, value cap enforced with a clear error, eviction at MAX_ENTRIES).

- [ ] **Step 2: Run, expect FAIL. Implement the store** (IndexedDB database `vibegarden-agent-memory`, object store `entries`, key `${agentId}:${userId}:${key}`, records `{ k, key, value, at }`; wrap open/get/put in small promisified helpers).

- [ ] **Step 3: Wire the executors, run `npm test -- app/components/workbench && npm run typecheck`, expect PASS.**

- [ ] **Step 4: Verify with the `verify` skill**: write a small tool in the editor (next task adds YAML editing; for now seed a tool through the create/save JSON), run the fetch-then-extract chain, watch runner logs on the card, remember/recall across a reload.

- [ ] **Step 5: Commit**

```bash
git add app/components/workbench app/routes/garden.agents.$id.tsx
git commit -m "Run user tools in the sandbox with memory and host bridging"
```

### Task 15: YAML tool editor

**Files:**
- Create: `app/lib/agents/yaml.ts`
- Create: `app/components/workbench/tool-editor.tsx`
- Modify: `app/lib/agents/contracts.ts` (export `parseAgentTool(raw): { value: AgentToolDef } | { error: string }`, reusing the existing tool schema)
- Modify: `app/components/workbench/definition-editor.tsx` (extract the left pane from `garden.agents.$id.tsx` if not already its own component, add the tools list + editor)
- Modify: `package.json` (add `yaml` dependency: `npm install yaml`)
- Test: `app/lib/agents/__tests__/yaml.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // yaml.ts (client-safe, no server imports)
  export function toolToYaml(tool: AgentToolDef): string; // source rendered as a block scalar (|-)
  export function toolFromYaml(text: string): { value: AgentToolDef } | { error: string }; // YAML parse errors and contract errors both land in error
  ```
  `tool-editor.tsx`: a textarea seeded with `toolToYaml(tool)`, live-parsed on change (debounced 300ms), inline error line under the editor, Apply button disabled while invalid; Apply calls `onChange(tool)` upward. The definition editor renders the tools list with add (seeds a commented example tool), edit (opens tool-editor), and remove; the Save button still posts the whole definition JSON, YAML never leaves the browser.

- [ ] **Step 1: Write failing yaml.ts tests**: round-trip a tool through `toolToYaml` then `toolFromYaml`; multi-line source survives as-is; a YAML syntax error returns a readable error; a valid-YAML invalid-tool (bad name) returns the contract error.

- [ ] **Step 2: Run `npm test -- app/lib/agents`, expect FAIL. Install `yaml`, implement both functions** (`stringify(tool, { blockQuote: "literal" })` and `parse` + `parseAgentTool`).

- [ ] **Step 3: Implement the editor components, run `npm test -- app/lib/agents app/components/workbench && npm run typecheck`, expect PASS.**

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app/lib/agents app/components/workbench
git commit -m "Edit workbench tools as YAML"
```

---

## Stage 4: skills and the Gardener sidekick

### Task 16: use_skill builtin

**Files:**
- Modify: `app/lib/agents/tools.server.ts`
- Test: extend `app/lib/agents/__tests__/tools.test.ts`

**Interfaces:**
- Produces: when `definition.skills.length > 0`, `agentToolSpecs` includes a server-executed (not delegated) spec `use_skill` with parameters `{ name: { type: "string" } }`; execute returns the skill's content, or `"Error: no skill named \"x\". Available: a, b."`; `noteFor` returns `{ type: "note", kind: "note", value: "reading skill <name>" }` so the trace shows the load.

- [ ] **Step 1: Write failing tests** (content returned, unknown-skill error lists available names, spec absent when no skills, note event shape).

- [ ] **Step 2: Run, expect FAIL. Implement. Run `npm test -- app/lib/agents`, expect PASS.**

- [ ] **Step 3: Verify**: give an agent a skill, watch the model load it mid-turn in the trace (the note bubble), confirm the prompt index lists it (Task 4 already renders the index).

- [ ] **Step 4: Commit**

```bash
git add app/lib/agents
git commit -m "Add use_skill builtin for workbench agents"
```

### Task 17: Gardener propose_tool and the sidekick panel

**Files:**
- Modify: `packages/agent-core/src/events.ts` (new event variant `{ type: "proposal"; name: string; description: string; parameters: Record<string, unknown>; source: string; rationale: string }`)
- Modify: `packages/agent-web/src/markers.ts` (`proposalNote`, `[[tool:proposal:...]]` decode, segment `{ type: "proposal"; ... }`, `markerForEvent` mapping, `toModelText` compaction to `[proposed tool <name>]`)
- Modify: `app/lib/gardener-tools.server.ts` (new `propose_tool` spec) and `app/lib/gardener-tools-config.server.ts` (offer it only when the request carries agent context)
- Modify: `app/lib/gardener.server.ts:53` (`WireContextItem` kind union gains `"agent-definition"`)
- Modify: `app/routes/api.chat.ts` (pass `agentContext: contextItems.some((c) => c.kind === "agent-definition")` into the tools config)
- Modify: `app/components/gardener/chat-message.tsx` (render proposal segments as a card: name, description, collapsible source in `<pre>`, an "Add to my agent" button dispatching `window.dispatchEvent(new CustomEvent("workbench:apply-tool", { detail: tool }))`)
- Modify: `app/routes/garden.agents.$id.tsx` (sidekick pane: embed the existing Gardener chat the way `garden.tsx` does, seeding a context item `{ kind: "agent-definition", label: agent.name, content: JSON.stringify(definition) }`; listen for `workbench:apply-tool` and stage the tool into the editor state as an unsaved change)
- Test: `packages/agent-web/src/__tests__/call.test.ts` (proposal marker round-trip), `app/lib/__tests__/gardener-tools.test.ts` pattern for the new spec

**Interfaces:**
- Produces: `propose_tool` is server-executed (the turn continues; no delegation round-trip). Its `execute` validates args with `parseAgentTool` (plus `rationale` string, 500 chars) and returns `"The proposal was shown to the builder; they will apply it if they like it. Do not repeat the source in chat."`; on invalid args it returns the contract error string. Its `noteFor` returns the proposal event above, which `api.chat.ts` already streams through `markerForEvent` (note/diagram branch: add `"proposal"` to that case list at `api.chat.ts:277-283`).

- [ ] **Step 1: Write failing tests**: proposal marker round-trip through `splitToolNotes`; `toModelText` compacts it; the spec validates and rejects a bad tool name; the spec is offered only with agent context.

- [ ] **Step 2: Run `npm test -- packages/agent-web app/lib`, expect FAIL. Implement the package and lib changes.**

- [ ] **Step 3: Implement the UI wiring** (proposal card, sidekick pane, apply event). Add one short section to `content/gardener/system-prompt.md` guidance via the existing tools rule placeholder: the spec's `promptGuidance` should tell the Gardener to propose small readable tools, explain raw-result anatomy, and never paste tool source into prose (the card shows it).

- [ ] **Step 4: Run `npm test && npm run typecheck`, expect PASS. Verify with the `verify` skill: ask the sidekick "write me a tool that pulls article text out of fetched HTML", apply the proposal, run it.**

- [ ] **Step 5: Commit**

```bash
git add packages app/lib app/routes/api.chat.ts app/components/gardener app/routes/garden.agents.$id.tsx content/gardener/system-prompt.md
git commit -m "Let the Gardener propose workbench tools"
```

---

## Stage 5: sharing, try-it, remix

### Task 18: Share and unshare

**Files:**
- Modify: `app/lib/agents/repository.server.ts` (`setAgentSharing`)
- Modify: `app/routes/garden.agents.$id.tsx` (share/unshare intents + status line "Shared with the club: version from <date>")
- Modify: `app/routes/garden.agents.tsx` (shared agents link to the try-it route)
- Test: extend `app/lib/agents/__tests__/repository.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function setAgentSharing(db, scope: AgentScope, agentId: string, share: boolean): Promise<Agent | null>;
  // share: visibility 'club' + sharedVersionId = latestVersionId (owner only; null when not owner or no version)
  // unshare: visibility 'private' + sharedVersionId null
  ```

- [ ] **Step 1: Write failing repository tests**: share pins the current latest version; a later `saveAgentVersion` does not move the pin; re-share moves it; unshare hides the agent from others' `listAgents` and `getAgentForUser`.

- [ ] **Step 2: Run `npm run test:d1 -- agents`, expect FAIL. Implement, run, expect PASS.**

- [ ] **Step 3: Wire the intents and status UI, `npm run typecheck`, commit**

```bash
git add app/lib/agents app/routes/garden.agents.$id.tsx app/routes/garden.agents.tsx
git commit -m "Share workbench agents with the club via pinned versions"
```

### Task 19: Try-it route and remix

**Files:**
- Create: `app/routes/garden.agents.$id.run.tsx`
- Modify: `app/routes.ts` (`route("garden/agents/:id/run", "routes/garden.agents.$id.run.tsx")` before the `:id` route registration order matters only for path specificity; React Router matches the longer path)
- Modify: `app/lib/agents/repository.server.ts` (`remixAgent`)
- Modify: `docs/ROADMAP.md` (Agent Workbench stages 3-5 landed)
- Test: extend `app/lib/agents/__tests__/repository.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function remixAgent(db, scope: AgentScope, agentId: string): Promise<Agent | null>;
  // copies the SHARED version's definition into a new private agent named "Remix of <name>",
  // owned by scope.userId; null when the source is not shared to the caller
  ```
  The run route: loader loads via `getAgentForUser` (non-owners get the pinned shared version), renders a read-only summary (name, description, builder, prompt in a `<details>`, each tool as collapsed YAML via `toolToYaml`: transparency is the point), the same trace chat wired with the same executors (runner + memory + fetch proxy; memory namespaced to the running user), and a Remix button posting `intent=remix` then redirecting to the new agent's workbench. Owners visiting their own run route get redirected to the workbench.

- [ ] **Step 1: Write failing `remixAgent` tests**: non-shared source returns null for a non-owner; remix copies the shared (not latest draft) definition; the copy is private and owned by the remixer.

- [ ] **Step 2: Run `npm run test:d1 -- agents`, expect FAIL. Implement, run, expect PASS.**

- [ ] **Step 3: Build the route, `npm run typecheck && npm test`, expect PASS.**

- [ ] **Step 4: Full verification** with the `verify` skill as two users: user A builds and shares an agent with a custom tool, user B tries it (A's JS runs in B's sandbox, B's memory stays B's), B remixes and edits. Update `docs/ROADMAP.md`.

- [ ] **Step 5: Commit**

```bash
git add app/routes.ts app/routes/garden.agents.$id.run.tsx app/lib/agents docs/ROADMAP.md
git commit -m "Add try-it and remix for shared workbench agents"
```

---

## Plan self-review notes

- Spec coverage: schema/versioning (Tasks 2, 3, 18), definition caps (1), prompt frame + skills index (4, 16), chat endpoint + continuation re-capping (5, 10), call markers + envelope (7), fetch proxy + SSRF matrix (8, 9), raw vs sent-to-model trace (11), runner CSP + protocol + security gate (12), host bridge + timeout-by-recreation (13), memory per user (14), YAML editing (15), Gardener propose_tool with human-in-the-loop apply (17), sharing/pinning/remix (18, 19). Test-conversation persistence is deliberately absent (spec non-goal).
- The one intentional deviation from the spec's wording: `propose_tool` is server-executed with a `proposal` event instead of a delegated tool, so the Gardener's turn continues without a continuation round-trip; the human-review "apply" gate is unchanged. Folded into the spec's intent, noted here for the reviewer.
- Rate limiting is per isolate and best effort; real spend protection remains the club credential caps. Called out in Task 9 as a code comment requirement.

