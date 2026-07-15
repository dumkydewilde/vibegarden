import { render, screen } from "@testing-library/react";
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
