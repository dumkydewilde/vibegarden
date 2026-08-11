import { describe, expect, it } from "vitest";
import { emptyDefinition } from "../contracts";
import { buildAgentSystemPrompt } from "../prompt.server";

describe("buildAgentSystemPrompt", () => {
  it("frames the builder prompt and includes it verbatim", () => {
    const prompt = buildAgentSystemPrompt(
      { ...emptyDefinition(), systemPrompt: "Answer only in haiku." },
      "WOTF",
      [],
    );

    expect(prompt).toContain("built by a member of WOTF");
    expect(prompt).toContain("Answer only in haiku.");
    expect(prompt.indexOf("built by")).toBeLessThan(prompt.indexOf("haiku"));
  });

  it("lists skills by name and description", () => {
    const prompt = buildAgentSystemPrompt(
      {
        ...emptyDefinition(),
        skills: [
          {
            name: "summarize",
            description: "How to summarize pages",
            content: "...",
          },
        ],
      },
      "WOTF",
      [],
    );

    expect(prompt).toContain("summarize: How to summarize pages");
  });

  it("says no tools are available when there are none", () => {
    expect(buildAgentSystemPrompt(emptyDefinition(), "WOTF", [])).toContain(
      "no tools",
    );
  });
});
