import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentToolDef } from "~/lib/agents/contracts";
import { toolToYaml } from "~/lib/agents/yaml";
import { ToolEditor } from "../tool-editor";

const tool: AgentToolDef = {
  name: "word_count",
  description: "Counts words in text.",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  source: "const words = args.text.trim().split(/\\s+/);\nreturn words.length;",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("ToolEditor", () => {
  it("debounces YAML validation and disables Apply while invalid", () => {
    vi.useFakeTimers();
    render(<ToolEditor tool={tool} onChange={() => {}} />);

    const editor = screen.getByRole("textbox", { name: "Tool YAML" });
    const apply = screen.getByRole("button", { name: "Apply tool" });
    expect(apply).toBeEnabled();

    fireEvent.change(editor, { target: { value: "name: [broken" } });
    expect(apply).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(300));

    expect(screen.getByRole("alert")).toHaveTextContent(/yaml|flow sequence|line/i);
    expect(apply).toBeDisabled();
  });

  it("applies the canonical tool parsed from valid YAML", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<ToolEditor tool={tool} onChange={onChange} />);
    const updated = {
      ...tool,
      description: "Counts every word in the supplied text.",
    };

    fireEvent.change(screen.getByRole("textbox", { name: "Tool YAML" }), {
      target: { value: toolToYaml(updated) },
    });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.click(screen.getByRole("button", { name: "Apply tool" }));

    expect(onChange).toHaveBeenCalledWith(updated);
  });
});
