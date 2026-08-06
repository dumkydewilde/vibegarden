import type { AgentDefinition } from "./contracts";
import { buildAgentSystemPrompt } from "./prompt.server";
import { agentToolSpecs } from "./tools.server";

export function buildAgentPromptPreview(
  definition: AgentDefinition,
  clubName: string,
): { offeredToolNames: string[]; modelPrompt: string } {
  const tools = agentToolSpecs(definition);
  return {
    offeredToolNames: tools.map((tool) => tool.name),
    modelPrompt: buildAgentSystemPrompt(definition, clubName, tools),
  };
}
