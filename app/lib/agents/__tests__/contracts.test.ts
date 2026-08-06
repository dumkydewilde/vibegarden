import { describe, expect, it } from "vitest";
import {
  DEFINITION_MAX_BYTES,
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

  it("accepts a valid tool", () => {
    const tool = {
      name: "extract_text",
      description: "Pulls readable text out of HTML.",
      parameters: { type: "object", properties: { html: { type: "string" } } },
      source: "return args.html.replace(/<[^>]+>/g, ' ');",
    };

    expect(parseAgentDefinition({ ...emptyDefinition(), tools: [tool] }).value).toBeDefined();
  });

  it("returns an error for a tool parameter that cannot be JSON serialized", () => {
    const result = parseAgentDefinition({
      ...emptyDefinition(),
      tools: [
        {
          name: "bigint_parameter",
          description: "Uses a non-JSON value.",
          parameters: { count: BigInt(1) },
          source: "return 1;",
        },
      ],
    });

    expect(result.value).toBeUndefined();
    expect(result.error).toMatch(/JSON serializ/i);
  });

  it("rejects a bad tool name", () => {
    const tool = {
      name: "Bad Name",
      description: "Pulls readable text out of HTML.",
      parameters: { type: "object" },
      source: "return 1;",
    };

    expect(parseAgentDefinition({ ...emptyDefinition(), tools: [tool] }).error).toMatch(/tool name/i);
  });

  it("rejects duplicate tool names", () => {
    const tool = {
      name: "extract_text",
      description: "d",
      parameters: { type: "object" },
      source: "return 1;",
    };

    expect(parseAgentDefinition({ ...emptyDefinition(), tools: [tool, tool] }).error).toMatch(
      /duplicate/i,
    );
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

  it("measures the total definition limit in UTF-8 bytes", () => {
    const definition = {
      ...emptyDefinition(),
      tools: Array.from({ length: 5 }, (_, i) => ({
        name: `tool_${i}`,
        description: "d",
        parameters: { type: "object" },
        source: "é".repeat(8_000),
      })),
    };

    expect(parseAgentDefinition(definition).error).toMatch(/64/);
  });

  it("rejects non-object and wrong-version input", () => {
    expect(parseAgentDefinition(null).error).toBeDefined();
    expect(parseAgentDefinition({ version: 2 }).error).toBeDefined();
  });
});
