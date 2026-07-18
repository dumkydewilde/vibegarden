import type { AgentEvent } from "./events";
import type { ToolCall } from "./sse";

/**
 * One tool, defined once in a provider-neutral shape. Adapters turn the
 * list into the OpenAI function-calling format (below) or, later, MCP tool
 * schemas. App-specific state (env, tokens) is captured in closures by
 * whatever factory builds the specs.
 */
export type ToolSpec = {
  name: string;
  description: string;
  /** Longer usage prose for the system prompt; falls back to description. */
  promptGuidance?: string;
  /** JSON-schema object describing the arguments. */
  parameters: Record<string, unknown>;
  /**
   * Server-side execution; the returned string goes back to the model as
   * the tool result. Return an "Error: ..." string rather than throwing,
   * so the model can repair the call.
   */
  execute: (args: Record<string, unknown>) => Promise<string> | string;
  /**
   * When present, a valid call is handed to the surface instead of being
   * executed here: the turn ends with a delegated-call event carrying the
   * returned payload. Return null for invalid arguments to fall through to
   * execute, which should then explain what was wrong.
   */
  delegate?: (args: Record<string, unknown>) => unknown | null;
  /**
   * The activity event surfaced while the tool runs (a note bubble, a
   * diagram), or null for none. Tools without noteFor get a default
   * "using <name>" note.
   */
  noteFor?: (args: Record<string, unknown>) => AgentEvent | null;
};

/** Compose the prompt's tools section from the exact specs being offered. */
export function composeToolsPrompt(
  specs: ToolSpec[],
  unavailableMessage: string,
): string {
  if (specs.length === 0) return unavailableMessage;
  return [
    "You can call tools, silently, whenever they make your answer more grounded:",
    ...specs.map(
      (spec) => `- ${spec.promptGuidance ?? `${spec.name}: ${spec.description}`}`,
    ),
    "Prefer one well-chosen tool call over none when facts matter; never call more than needed. Do not mention tool names to the person.",
  ].join("\n");
}

/** The tool list as OpenAI-format function definitions. */
export function openAiToolDefinitions(specs: ToolSpec[]) {
  return specs.map((spec) => ({
    type: "function" as const,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  }));
}

export function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

const specFor = (specs: ToolSpec[], name: string) =>
  specs.find((spec) => spec.name === name);

/** Execute one call against the specs; always resolves to a result string. */
export async function runToolCall(
  specs: ToolSpec[],
  call: ToolCall,
): Promise<string> {
  const args = parseArgs(call.arguments);
  if (!args) return "Error: tool arguments were not valid JSON.";
  const spec = specFor(specs, call.name);
  if (!spec) return `Error: unknown tool "${call.name}".`;
  return spec.execute(args);
}

/** The activity event for one call, or null when the tool suppresses it. */
export function noteEventFor(
  specs: ToolSpec[],
  call: ToolCall,
): AgentEvent | null {
  const spec = specFor(specs, call.name);
  const args = parseArgs(call.arguments) ?? {};
  if (spec?.noteFor) return spec.noteFor(args);
  return { type: "note", kind: "note", value: `using ${call.name}` };
}

/**
 * A delegated-call event payload for one call, when its tool delegates and
 * the arguments are valid. Null otherwise (the call then goes through
 * runToolCall so the model hears what was wrong).
 */
export function delegationFor(
  specs: ToolSpec[],
  call: ToolCall,
): { tool: string; payload: unknown } | null {
  const spec = specFor(specs, call.name);
  if (!spec?.delegate) return null;
  const args = parseArgs(call.arguments);
  if (!args) return null;
  const payload = spec.delegate(args);
  return payload == null ? null : { tool: call.name, payload };
}
