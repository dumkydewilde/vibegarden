import { fireEvent, render, screen } from "@testing-library/react";
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

function renderEditor() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <DefinitionEditor
          agent={{ name: "Text helper", description: "Works with text." }}
          definition={definition}
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
      (document.querySelector('input[name="definition"]') as HTMLInputElement).value,
    ) as AgentDefinition;
    expect(saved.tools.map(({ name }) => name)).toEqual(["word_count", "my_tool"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove my_tool" }));
    saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement).value,
    ) as AgentDefinition;
    expect(saved.tools.map(({ name }) => name)).toEqual(["word_count"]);
  });

  it("opens an existing tool for editing", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Edit word_count" }));

    expect(
      (screen.getByRole("textbox", { name: "Tool YAML" }) as HTMLTextAreaElement).value,
    ).toContain("name: word_count");
  });
});
