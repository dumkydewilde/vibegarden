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
          ...definition.skills.map((skill) => `- ${skill.name}: ${skill.description}`),
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
