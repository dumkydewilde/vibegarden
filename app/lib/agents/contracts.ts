import { z } from "zod";

/** Caps are product decisions from the workbench spec. Keep them in sync there. */
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

  if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > DEFINITION_MAX_BYTES) {
    return { error: "definition exceeds 64KB; trim tool sources or skills" };
  }

  return { value: parsed.data };
}
