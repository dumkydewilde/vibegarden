import { describe, expect, it } from "vitest";

import type { AgentToolDef } from "../contracts";
import { toolFromYaml, toolToYaml } from "../yaml";

const tool: AgentToolDef = {
  name: "extract_title",
  description: "Extracts a page title from HTML.",
  parameters: {
    type: "object",
    properties: { html: { type: "string" } },
    required: ["html"],
  },
  source:
    "const match = args.html.match(/<title>(.*?)<\\/title>/i);\nreturn match?.[1] ?? null;",
};

describe("agent tool YAML", () => {
  it("round-trips a tool through the YAML editing format", () => {
    const yaml = toolToYaml(tool);

    expect(yaml).toContain("source: |-");
    expect(toolFromYaml(yaml)).toEqual({ value: tool });
  });

  it("preserves multiline source exactly", () => {
    const multiline = {
      ...tool,
      source: "const title = args.title;\n\nreturn {\n  title,\n};",
    };

    const parsed = toolFromYaml(toolToYaml(multiline));

    expect(parsed).toEqual({ value: multiline });
  });

  it("returns a readable YAML syntax error", () => {
    const parsed = toolFromYaml("name: extract_title\nparameters: [oops\n");

    expect(parsed).toHaveProperty("error");
    expect("error" in parsed && parsed.error).toMatch(
      /yaml|flow sequence|line/i,
    );
  });

  it("returns a tool contract error for valid YAML with an invalid tool", () => {
    const parsed = toolFromYaml(`
name: Bad Name
description: Invalid name
parameters:
  type: object
source: return 1;
`);

    expect(parsed).toHaveProperty("error");
    expect("error" in parsed && parsed.error).toMatch(/tool name/i);
  });

  it.each([".nan", ".inf", "1e999", "!!binary SGVsbG8="])(
    "rejects the non-JSON YAML parameter value %s without coercing it",
    (value) => {
      const parsed = toolFromYaml(`
name: unsafe_parameter
description: Contains a value JSON cannot preserve.
parameters:
  type: object
  nested:
    value: ${value}
source: return 1;
`);

      expect(parsed).toHaveProperty("error");
      expect("error" in parsed && parsed.error).toMatch(/JSON|serialize|loss/i);
    },
  );

  it("refuses to render a typed tool whose parameters are not lossless JSON", () => {
    const unsafe = {
      ...tool,
      parameters: { type: "object", default: Number.NaN },
    } as AgentToolDef;

    expect(() => toolToYaml(unsafe)).toThrow(/JSON|serialize|loss/i);
  });

  it("preserves ordinary nested JSON parameter values exactly", () => {
    const parsed = toolFromYaml(`
name: nested_values
description: Uses every native JSON value shape.
parameters:
  type: object
  examples:
    - null
    - true
    - 3.5
    - text
    - nested:
        count: 2
        enabled: false
source: return args;
`);

    expect(parsed).toEqual({
      value: {
        name: "nested_values",
        description: "Uses every native JSON value shape.",
        parameters: {
          type: "object",
          examples: [
            null,
            true,
            3.5,
            "text",
            { nested: { count: 2, enabled: false } },
          ],
        },
        source: "return args;",
      },
    });
  });

  it("preserves an own __proto__ JSON key without schema coercion", () => {
    const parsed = toolFromYaml(`
name: reserved_json_key
description: Preserves a valid JSON property name.
parameters:
  type: object
  __proto__:
    marker: preserved
source: return args;
`);

    expect(parsed).toHaveProperty("value");
    if (!("value" in parsed) || !parsed.value) return;
    expect(Object.hasOwn(parsed.value.parameters, "__proto__")).toBe(true);
    expect(JSON.parse(JSON.stringify(parsed.value.parameters))).toEqual(
      JSON.parse('{"type":"object","__proto__":{"marker":"preserved"}}'),
    );
  });
});
