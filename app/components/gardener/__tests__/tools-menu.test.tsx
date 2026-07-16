import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolsMenu } from "../tools-menu";

const setWebSearch = vi.fn();

vi.mock("~/components/gardener/gardener-provider", () => ({
  useGardener: () => ({
    webSearch: false,
    setWebSearch,
    attachDataset: vi.fn(),
    attachingDataset: null,
    datasets: [],
    removeDataset: vi.fn(),
  }),
}));

describe("ToolsMenu", () => {
  it("shows an off web-search switch that enables web search", () => {
    render(<ToolsMenu />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Tools" }), {
      button: 0,
      ctrlKey: false,
    });

    const webSearchSwitch = screen.getByRole("switch", {
      name: "Web search",
    });
    expect(webSearchSwitch).toHaveAttribute("data-state", "unchecked");

    fireEvent.click(webSearchSwitch);

    expect(setWebSearch).toHaveBeenCalledWith(true);
  });
});
