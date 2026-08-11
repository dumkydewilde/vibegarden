import { describe, expect, it } from "vitest";

import { emptyDefinition } from "../contracts";
import { buildAgentPromptPreview } from "../preview.server";

describe("buildAgentPromptPreview", () => {
  it("uses the complete saved tool set including builtins and skills", () => {
    const preview = buildAgentPromptPreview(
      {
        ...emptyDefinition(),
        tools: [
          {
            name: "extract_title",
            description: "Extract a page title.",
            parameters: { type: "object" },
            source: "return args.title;",
          },
        ],
        skills: [
          {
            name: "fact_checking",
            description: "Check claims against supplied evidence.",
            content: "Verify every claim.",
          },
        ],
      },
      "Garden Club",
    );

    expect(preview.offeredToolNames).toEqual([
      "extract_title",
      "fetch_page",
      "remember",
      "recall",
      "use_skill",
    ]);
    expect(preview.modelPrompt).toContain("extract_title");
    expect(preview.modelPrompt).toContain("fetch_page");
    expect(preview.modelPrompt).toContain("remember");
    expect(preview.modelPrompt).toContain("recall");
    expect(preview.modelPrompt).toContain("use_skill");
    expect(preview.modelPrompt).toContain(
      "fact_checking: Check claims against supplied evidence.",
    );
  });
});
