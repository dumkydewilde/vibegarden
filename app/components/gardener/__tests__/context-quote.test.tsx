import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContextQuote } from "../context-quote";

describe("ContextQuote", () => {
  it("renders agent definition context without exposing its JSON preview", () => {
    const onRemove = vi.fn();
    render(
      <ContextQuote
        item={{
          kind: "agent-definition",
          label: "Article Tool Builder",
          content: '{"systemPrompt":"private draft"}',
        }}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText("Article Tool Builder")).toBeVisible();
    expect(screen.queryByText(/private draft/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Article Tool Builder from context",
      }),
    );
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
