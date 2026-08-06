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
  source: "const match = args.html.match(/<title>(.*?)<\\/title>/i);\nreturn match?.[1] ?? null;",
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
    expect("error" in parsed && parsed.error).toMatch(/yaml|flow sequence|line/i);
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
});
