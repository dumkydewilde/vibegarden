import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "../model-picker";

const toolModel = {
  id: "model:tools",
  label: "Tool model",
  note: "free",
  tools: true,
};
const textModel = {
  id: "model:text",
  label: "Text model",
  note: "legacy",
  tools: false,
};
const setModel = vi.fn();

vi.mock("../gardener-provider", () => ({
  useGardener: () => ({
    model: toolModel,
    allowedModels: [toolModel, textModel],
    setModel,
  }),
}));

describe("ModelPicker", () => {
  it("labels whether each model can render visuals and use tools", async () => {
    render(<ModelPicker />);

    fireEvent.keyDown(screen.getByRole("button", { name: /Tool model/ }), {
      key: "ArrowDown",
    });

    expect(await screen.findByText("free · visuals + tools")).toBeTruthy();
    expect(screen.getByText("legacy · text only")).toBeTruthy();
  });
});
