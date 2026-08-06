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
export const RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "fetch_page",
  "remember",
  "recall",
  "use_skill",
  "query_data",
  "attach_data",
]);

const toolSchema = z.object({
  name: z
    .string()
    .regex(TOOL_NAME_RE, "tool name must be snake_case, 1-40 chars"),
  description: z.string().min(1).max(TOOL_DESCRIPTION_MAX_CHARS),
  parameters: z.record(z.string(), z.unknown()),
  source: z.string().min(1).max(TOOL_SOURCE_MAX_CHARS),
});

const skillSchema = z.object({
  name: z
    .string()
    .regex(TOOL_NAME_RE, "skill name must be snake_case, 1-40 chars"),
  description: z.string().min(1).max(TOOL_DESCRIPTION_MAX_CHARS),
  content: z.string().min(1).max(SKILL_CONTENT_MAX_CHARS),
});

const definitionSchema = z.object({
  version: z.literal(1),
  systemPrompt: z
    .string()
    .max(SYSTEM_PROMPT_MAX_CHARS, "system prompt too long"),
  tools: z.array(toolSchema).max(MAX_TOOLS),
  skills: z.array(skillSchema).max(MAX_SKILLS),
  builtins: z.object({ fetchPage: z.boolean(), memory: z.boolean() }),
});

export type AgentToolDef = z.infer<typeof toolSchema>;
export type AgentSkillDef = z.infer<typeof skillSchema>;
export type AgentDefinition = z.infer<typeof definitionSchema>;

type OwnDataProperty =
  { found: true; value: unknown } | { found: false; value?: never };

function ownDataProperty(value: unknown, key: string): OwnDataProperty {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return { found: false };
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor
    ? { found: true, value: descriptor.value }
    : { found: false };
}

function isLosslessJsonValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const ownKeys = Reflect.ownKeys(value);
    const keys = Object.keys(value);
    if (ownKeys.length !== keys.length + 1 || !ownKeys.includes("length")) {
      return false;
    }
    if (keys.length !== value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (keys[index] !== String(index)) return false;
    }

    ancestors.add(value);
    const valid = keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(
        descriptor &&
        descriptor.enumerable &&
        "value" in descriptor &&
        isLosslessJsonValue(descriptor.value, ancestors),
      );
    });
    ancestors.delete(value);
    return valid;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== keys.length) return false;

  ancestors.add(value);
  const valid = keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(
      descriptor &&
      descriptor.enumerable &&
      "value" in descriptor &&
      isLosslessJsonValue(descriptor.value, ancestors),
    );
  });
  ancestors.delete(value);
  return valid;
}

export function parseAgentTool(
  raw: unknown,
): { value: AgentToolDef; error?: never } | { value?: never; error: string } {
  try {
    const parsed = toolSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { error: `${first.path.join(".") || "tool"}: ${first.message}` };
    }
    if (RESERVED_TOOL_NAMES.has(parsed.data.name)) {
      return { error: `tool name "${parsed.data.name}" is reserved` };
    }
    const parameters = ownDataProperty(raw, "parameters");
    if (!parameters.found || !isLosslessJsonValue(parameters.value)) {
      return {
        error:
          "tool parameters must contain only values that are JSON serializable without loss",
      };
    }
    return {
      value: {
        ...parsed.data,
        parameters: parameters.value as Record<string, unknown>,
      },
    };
  } catch {
    return { error: "tool could not be parsed safely" };
  }
}

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
):
  { value: AgentDefinition; error?: never } | { value?: never; error: string } {
  try {
    const parsed = definitionSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        error: `${first.path.join(".") || "definition"}: ${first.message}`,
      };
    }

    const rawTools = ownDataProperty(raw, "tools");
    if (!rawTools.found || !Array.isArray(rawTools.value)) {
      return { error: "tools: expected an own array value" };
    }
    const tools: AgentToolDef[] = [];
    for (let index = 0; index < rawTools.value.length; index += 1) {
      const tool = parseAgentTool(rawTools.value[index]);
      if ("error" in tool) {
        return { error: `tools.${index}: ${tool.error}` };
      }
      tools.push(tool.value);
    }
    const definition: AgentDefinition = { ...parsed.data, tools };

    const names = new Set<string>();
    for (const item of [...definition.tools, ...definition.skills]) {
      if (names.has(item.name))
        return { error: `duplicate name "${item.name}"` };
      names.add(item.name);
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(definition);
    } catch {
      return { error: "definition must contain only JSON serializable values" };
    }

    if (new TextEncoder().encode(serialized).length > DEFINITION_MAX_BYTES) {
      return { error: "definition exceeds 64KB; trim tool sources or skills" };
    }

    return { value: definition };
  } catch {
    return { error: "definition could not be parsed safely" };
  }
}
