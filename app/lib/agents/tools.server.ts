import type { ToolSpec } from "@vibegarden/agent-core";

import {
  RESERVED_TOOL_NAMES,
  type AgentDefinition,
} from "./contracts";
import { checkFetchUrl } from "./fetch-guard.server";

const MEMORY_KEY_MAX_CHARS = 80;
const MEMORY_VALUE_MAX_CHARS = 500;

function userToolSpec(
  tool: AgentDefinition["tools"][number],
): ToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    delegate: (args) => args,
    execute: () => "Error: this workbench tool could not be delegated.",
    noteFor: () => null,
  };
}

const fetchPageSpec: ToolSpec = {
  name: "fetch_page",
  description:
    "Fetch a public HTTPS page and return its readable response body.",
  promptGuidance:
    "fetch_page(url): fetch a public HTTPS page when its contents would ground the answer.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full HTTPS URL of the page to fetch.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  delegate: (args) => {
    if (typeof args.url !== "string") return null;
    return checkFetchUrl(args.url).error ? null : args;
  },
  execute: (args) => {
    if (typeof args.url !== "string") {
      return "Error: fetch_page needs a string URL.";
    }
    const checked = checkFetchUrl(args.url);
    return checked.error
      ? `Error: ${checked.error}`
      : "Error: this fetch_page call could not be delegated.";
  },
  noteFor: () => null,
};

function validMemoryKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MEMORY_KEY_MAX_CHARS
  );
}

function validMemoryValue(value: unknown): value is string {
  return typeof value === "string" && value.length <= MEMORY_VALUE_MAX_CHARS;
}

const rememberSpec: ToolSpec = {
  name: "remember",
  description: "Remember one short value under a key for later turns.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", minLength: 1, maxLength: MEMORY_KEY_MAX_CHARS },
      value: { type: "string", maxLength: MEMORY_VALUE_MAX_CHARS },
    },
    required: ["key", "value"],
    additionalProperties: false,
  },
  delegate: (args) =>
    validMemoryKey(args.key) && validMemoryValue(args.value)
      ? { op: "remember", key: args.key, value: args.value }
      : null,
  execute: (args) => {
    if (!validMemoryKey(args.key)) {
      return `Error: memory keys must be 1 to ${MEMORY_KEY_MAX_CHARS} characters.`;
    }
    if (!validMemoryValue(args.value)) {
      return `Error: memory values must be ${MEMORY_VALUE_MAX_CHARS} characters or fewer.`;
    }
    return "Error: this remember call could not be delegated.";
  },
  noteFor: () => null,
};

const recallSpec: ToolSpec = {
  name: "recall",
  description: "Recall values remembered during earlier turns.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  delegate: () => ({ op: "recall" }),
  execute: () => "Error: this recall call could not be delegated.",
  noteFor: () => null,
};

function useSkillSpec(skills: AgentDefinition["skills"]): ToolSpec {
  return {
    name: "use_skill",
    description: "Load the detailed instructions for one named skill.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    execute: (args) => {
      const name = typeof args.name === "string" ? args.name : "";
      const skill = skills.find((candidate) => candidate.name === name);
      return (
        skill?.content ??
        `Error: no skill named ${JSON.stringify(name)}. Available: ${skills.map((candidate) => candidate.name).join(", ")}.`
      );
    },
    noteFor: (args) => ({
      type: "note",
      kind: "note",
      value: `reading skill ${typeof args.name === "string" ? args.name : ""}`,
    }),
  };
}

export function agentToolSpecs(definition: AgentDefinition): ToolSpec[] {
  return [
    ...definition.tools
      .filter((tool) => !RESERVED_TOOL_NAMES.has(tool.name))
      .map(userToolSpec),
    ...(definition.builtins.fetchPage ? [fetchPageSpec] : []),
    ...(definition.builtins.memory ? [rememberSpec, recallSpec] : []),
    ...(definition.skills.length > 0 ? [useSkillSpec(definition.skills)] : []),
  ];
}
