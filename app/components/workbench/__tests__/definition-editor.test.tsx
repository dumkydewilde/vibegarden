import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import type { AgentDefinition } from "~/lib/agents/contracts";
import { DefinitionEditor } from "../definition-editor";

const definition: AgentDefinition = {
  version: 1,
  systemPrompt: "Help with short pieces of text.",
  tools: [
    {
      name: "word_count",
      description: "Counts words in text.",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      source: "return args.text.trim().split(/\\s+/).length;",
    },
  ],
  skills: [],
  builtins: { fetchPage: true, memory: true },
};

function renderEditor(
  currentDefinition = definition,
  stagedTool?: AgentDefinition["tools"][number],
) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <DefinitionEditor
          agent={{ name: "Text helper", description: "Works with text." }}
          definition={currentDefinition}
          stagedTool={stagedTool}
        />
      ),
      action: () => null,
    },
  ]);
  render(<Stub />);
}

describe("DefinitionEditor", () => {
  it("stages added and removed tools in the canonical definition JSON", () => {
    renderEditor();

    expect(screen.getByText("word_count")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));

    const yaml = screen.getByRole("textbox", { name: "Tool YAML" });
    expect((yaml as HTMLTextAreaElement).value).toContain("#");
    fireEvent.click(screen.getByRole("button", { name: "Apply tool" }));

    expect(screen.getByText("my_tool")).toBeVisible();
    let saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement)
        .value,
    ) as AgentDefinition;
    expect(saved.tools.map(({ name }) => name)).toEqual([
      "word_count",
      "my_tool",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove my_tool" }));
    saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement)
        .value,
    ) as AgentDefinition;
    expect(saved.tools.map(({ name }) => name)).toEqual(["word_count"]);
  });

  it("opens an existing tool for editing", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Edit word_count" }));

    expect(
      (
        screen.getByRole("textbox", {
          name: "Tool YAML",
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("name: word_count");
  });

  it("reserves skill names when seeding and applying tools", async () => {
    renderEditor({
      ...definition,
      skills: [
        {
          name: "my_tool",
          description: "A reusable default skill.",
          content: "Use the default method.",
        },
        {
          name: "editorial_voice",
          description: "A reusable writing skill.",
          content: "Write clearly.",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    const editor = screen.getByRole("textbox", { name: "Tool YAML" });
    expect((editor as HTMLTextAreaElement).value).toContain("name: my_tool_2");

    fireEvent.change(editor, {
      target: {
        value: (editor as HTMLTextAreaElement).value.replace(
          "name: my_tool_2",
          "name: editorial_voice",
        ),
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply tool" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply tool" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /editorial_voice.*already exists/i,
    );
    const saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement)
        .value,
    ) as AgentDefinition;
    expect(saved.tools.map(({ name }) => name)).toEqual(["word_count"]);
  });

  it("applies nested JSON parameters to the hidden canonical definition without loss", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    const editor = screen.getByRole("textbox", { name: "Tool YAML" });
    fireEvent.change(editor, {
      target: {
        value: `
name: json_values
description: Preserves nested JSON parameters.
parameters:
  type: object
  examples:
    - null
    - true
    - 3.5
    - nested:
        label: exact
source: return args;
`,
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply tool" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply tool" }));

    const saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement)
        .value,
    ) as AgentDefinition;
    expect(saved.tools.at(-1)?.parameters).toEqual({
      type: "object",
      examples: [null, true, 3.5, { nested: { label: "exact" } }],
    });
  });

  it("stages a sidekick proposal without discarding current tools", () => {
    const stagedTool = {
      name: "extract_article_text",
      description: "Extracts readable article text from fetched HTML.",
      parameters: { type: "object", properties: {} },
      source: "return String(args.html ?? '');",
    };

    renderEditor(definition, stagedTool);

    expect(screen.getByText("extract_article_text")).toBeVisible();
    const saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement)
        .value,
    ) as AgentDefinition;
    expect(saved.tools).toEqual([...definition.tools, stagedTool]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove extract_article_text" }),
    );
    expect(screen.queryByText("extract_article_text")).toBeNull();
  });
});
