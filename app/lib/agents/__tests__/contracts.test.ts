import { describe, expect, it } from "vitest";
import {
  DEFINITION_MAX_BYTES,
  emptyDefinition,
  parseAgentDefinition,
  parseAgentTool,
  SYSTEM_PROMPT_MAX_CHARS,
} from "../contracts";

const validTool = {
  name: "inspect_value",
  description: "Inspects a parameter value.",
  parameters: { type: "object" } as Record<string, unknown>,
  source: "return args;",
};

describe("parseAgentTool", () => {
  it.each([
    ["a nested non-finite number", { nested: { value: Number.NaN } }],
    ["a typed array", { nested: new Uint8Array([1, 2, 3]) }],
    ["a Date", { nested: new Date("2026-08-06T00:00:00Z") }],
    ["a transforming object", { nested: { toJSON: () => "changed" } }],
    [
      "a non-enumerable object value",
      {
        nested: Object.defineProperty({ visible: true }, "hidden", {
          value: "lost",
        }),
      },
    ],
    ["an undefined array entry", { nested: [1, undefined] }],
  ])("rejects parameters containing %s", (_label, parameters) => {
    const parsed = parseAgentTool({ ...validTool, parameters });

    expect(parsed.value).toBeUndefined();
    expect(parsed.error).toMatch(/JSON|serialize|loss/i);
  });
});

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

    expect(
      parseAgentDefinition({ ...emptyDefinition(), tools: [tool] }).value,
    ).toBeDefined();
  });

  it("preserves valid JSON parameter keys through definition parsing", () => {
    const parameters = JSON.parse(
      '{"type":"object","__proto__":{"marker":"preserved"}}',
    ) as Record<string, unknown>;
    const result = parseAgentDefinition({
      ...emptyDefinition(),
      tools: [{ ...validTool, parameters }],
    });

    expect(result.error).toBeUndefined();
    const savedParameters = result.value?.tools[0]?.parameters as
      Record<string, unknown> | undefined;
    expect(savedParameters && Object.hasOwn(savedParameters, "__proto__")).toBe(
      true,
    );
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

  it("returns an error when validation reads a throwing getter", () => {
    const definition = new Proxy(emptyDefinition(), {
      get(target, property, receiver) {
        if (property === "systemPrompt") throw new Error("hostile getter");
        return Reflect.get(target, property, receiver);
      },
    });

    const result = parseAgentDefinition(definition);

    expect(result.value).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it("rejects a bad tool name", () => {
    const tool = {
      name: "Bad Name",
      description: "Pulls readable text out of HTML.",
      parameters: { type: "object" },
      source: "return 1;",
    };

    expect(
      parseAgentDefinition({ ...emptyDefinition(), tools: [tool] }).error,
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

  it.each([
    "fetch_page",
    "remember",
    "recall",
    "use_skill",
    "query_data",
    "attach_data",
  ])("rejects the reserved tool name %s", (name) => {
    const tool = {
      name,
      description: "Attempts to replace a trusted builtin.",
      parameters: { type: "object" },
      source: "return 1;",
    };

    expect(
      parseAgentDefinition({ ...emptyDefinition(), tools: [tool] }).error,
    ).toMatch(/reserved/i);
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
