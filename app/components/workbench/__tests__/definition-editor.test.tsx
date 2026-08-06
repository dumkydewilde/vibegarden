import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import type { AgentDefinition } from "~/lib/agents/contracts";
import { DefinitionEditor } from "../definition-editor";
import { useScopedToolProposal } from "../use-scoped-tool-proposal";

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

const stagedTool = {
  name: "extract_article_text",
  description: "Extracts readable article text from fetched HTML.",
  parameters: { type: "object", properties: {} },
  source: "return String(args.html ?? '');",
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

function renderScopedEditor() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => {
        const [agentId, setAgentId] = useState("agent-a");
        const proposal = useScopedToolProposal(agentId, true);
        return (
          <>
            <button type="button" onClick={() => setAgentId("agent-a")}>
              Agent A
            </button>
            <button type="button" onClick={() => setAgentId("agent-b")}>
              Agent B
            </button>
            <DefinitionEditor
              key={agentId}
              agent={{ name: "Text helper", description: "Works with text." }}
              definition={definition}
              stagedTool={proposal}
            />
          </>
        );
      },
      action: () => null,
    },
  ]);
  render(<Stub />);
}

function applyProposal(agentId: string) {
  window.dispatchEvent(
    new CustomEvent("workbench:apply-tool", {
      detail: { agentId, tool: stagedTool },
    }),
  );
}

describe("DefinitionEditor", () => {
  it("stages added, edited, and removed skills in the canonical definition JSON", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Skill name" }), {
      target: { value: "editorial_voice" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Skill description" }),
      { target: { value: "A concise editorial style." } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Skill content" }), {
      target: { value: "Prefer short sentences and concrete verbs." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply skill" }));

    expect(screen.getByText("editorial_voice")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit editorial_voice" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Skill content" }), {
      target: { value: "Prefer direct sentences and concrete verbs." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply skill" }));

    let saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement)
        .value,
    ) as AgentDefinition;
    expect(saved.skills).toEqual([
      {
        name: "editorial_voice",
        description: "A concise editorial style.",
        content: "Prefer direct sentences and concrete verbs.",
      },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove editorial_voice" }),
    );
    saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement)
        .value,
    ) as AgentDefinition;
    expect(saved.skills).toEqual([]);
  });

  it("rejects skill names that collide with a custom tool", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Skill name" }), {
      target: { value: "word_count" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply skill" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /word_count.*already exists/i,
    );
    const saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement)
        .value,
    ) as AgentDefinition;
    expect(saved.skills).toEqual([]);
  });

  it("stages explicit fetch and memory builtin toggles", () => {
    renderEditor();

    const fetchPage = screen.getByRole("switch", { name: "Fetch pages" });
    const memory = screen.getByRole("switch", { name: "Memory" });
    expect(fetchPage).toBeChecked();
    expect(memory).toBeChecked();

    fireEvent.click(fetchPage);
    fireEvent.click(memory);

    const saved = JSON.parse(
      (document.querySelector('input[name="definition"]') as HTMLInputElement)
        .value,
    ) as AgentDefinition;
    expect(saved.builtins).toEqual({ fetchPage: false, memory: false });
  });

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

  it("does not auto-stage a removed proposal after returning to its agent", () => {
    renderScopedEditor();

    act(() => applyProposal("agent-a"));
    expect(screen.getByText("extract_article_text")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove extract_article_text" }),
    );
    expect(screen.queryByText("extract_article_text")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Agent B" }));
    expect(screen.queryByText("extract_article_text")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Agent A" }));

    expect(screen.queryByText("extract_article_text")).toBeNull();
  });
});
