import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidDiagram } from "../mermaid-block";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
});

describe("MermaidDiagram", () => {
  it("renders an accessible SVG after its loading state", async () => {
    mermaid.render.mockResolvedValue({
      svg: "<svg><text>Flow</text></svg>",
    });
    render(
      <MermaidDiagram
        code="flowchart TD; A-->B"
        ariaLabel="Request flow"
        loadingFallback={<p>Rendering flow...</p>}
        fallback={<p>Could not render flow.</p>}
      />,
    );

    expect(screen.getByText("Rendering flow...")).toBeInTheDocument();
    const image = await screen.findByRole("img", { name: "Request flow" });
    expect(image).toContainHTML("<text>Flow</text>");
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: "base",
        themeVariables: expect.objectContaining({
          background: "#fffcf5",
          primaryColor: "#e2f2e5",
          primaryBorderColor: "#5f8869",
          primaryTextColor: "#26362b",
          lineColor: "#315c41",
          arrowheadColor: "#315c41",
        }),
      }),
    );
  });

  it("uses a contrast-safe garden palette in dark mode", async () => {
    document.documentElement.classList.add("dark");
    mermaid.render.mockResolvedValue({ svg: "<svg />" });

    try {
      render(
        <MermaidDiagram
          code="flowchart TD; A-->B"
          fallback={<p>Could not render flow.</p>}
        />,
      );

      await waitFor(() =>
        expect(mermaid.initialize).toHaveBeenLastCalledWith(
          expect.objectContaining({
            theme: "base",
            themeVariables: expect.objectContaining({
              background: "#202823",
              primaryColor: "#304a38",
              primaryBorderColor: "#78a985",
              primaryTextColor: "#f0f5ef",
              lineColor: "#9dc3a4",
              arrowheadColor: "#9dc3a4",
            }),
          }),
        ),
      );
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("shows the supplied fallback when Mermaid rejects the source", async () => {
    mermaid.render.mockRejectedValue(new Error("bad Mermaid"));
    render(
      <MermaidDiagram
        code="not Mermaid"
        loadingFallback={<p>Rendering flow...</p>}
        fallback={<pre>not Mermaid</pre>}
      />,
    );

    expect(await screen.findByText("not Mermaid")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
