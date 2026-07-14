import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListItemWithAsk, ParagraphWithAsk } from "../paragraph-with-ask";

const addContext = vi.fn();

vi.mock("~/components/gardener/gardener-provider", () => ({
  useGardener: () => ({ addContext }),
}));

describe("ListItemWithAsk", () => {
  it("adds the list item's text to the Gardener context", () => {
    render(<ListItemWithAsk>Use a small first step.</ListItemWithAsk>);

    const button = screen.getByRole("button", {
      name: "Ask The Gardener about this list item",
    });
    fireEvent.click(button);

    expect(addContext).toHaveBeenCalledWith({
      kind: "paragraph",
      label: '"Use a small first step."',
      content: "Use a small first step.",
    });
    expect(button.classList.contains("text-primary")).toBe(true);
  });
});

describe("ParagraphWithAsk", () => {
  it("does not add a Gardener control inside a blockquote", () => {
    render(
      <blockquote>
        <ParagraphWithAsk>Quoted advice stays uncluttered.</ParagraphWithAsk>
      </blockquote>,
    );

    expect(
      screen.queryByRole("button", {
        name: "Ask The Gardener about this paragraph",
      }),
    ).toBeNull();
  });
});
