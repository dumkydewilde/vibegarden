import { parse, stringify } from "yaml";

import { parseAgentTool, type AgentToolDef } from "./contracts";

/** Human-editable form only. Persisted definitions remain canonical JSON. */
export function toolToYaml(tool: AgentToolDef): string {
  return stringify(tool, { blockQuote: "literal" });
}

export function toolFromYaml(
  text: string,
): { value: AgentToolDef; error?: never } | { value?: never; error: string } {
  try {
    return parseAgentTool(parse(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid YAML.";
    return { error: `YAML: ${message}` };
  }
}
