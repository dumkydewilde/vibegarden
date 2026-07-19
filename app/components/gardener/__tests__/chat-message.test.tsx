import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ChatMessageBubble } from "../chat-message";
import { diagramNote, toolNote } from "@vibegarden/agent-web";

vi.mock("~/components/mermaid-block", () => ({
  MermaidDiagram: ({
    code,
    ariaLabel,
  }: {
    code: string;
    ariaLabel?: string;
  }) => (
    <div role="img" aria-label={ariaLabel} data-code={code}>
      {code}
    </div>
  ),
}));

const gardener = (text: string, error = false) => ({
  id: "g1",
  role: "gardener" as const,
  text,
  error,
});

const renderMessage = (ui: React.ReactNode) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(cleanup);

describe("ChatMessageBubble activity", () => {
  it("shows a shimmered thinking status for an empty streaming reply", () => {
    renderMessage(<ChatMessageBubble message={gardener("")} isStreaming />);

    const status = screen.getByText("The Gardener is thinking...");
    expect(status.classList.contains("shimmer")).toBe(true);
  });

  it("renders an empty completed Gardener message without a shimmer", () => {
    renderMessage(<ChatMessageBubble message={gardener("")} />);

    expect(screen.queryByText("The Gardener is thinking...")).toBeNull();
  });

  it("shimmers the trailing article tool with its article title", () => {
    renderMessage(
      <ChatMessageBubble
        message={gardener(toolNote("article", "what-is-an-llm"))}
        isStreaming
      />,
    );

    const status = screen.getByText("Reading What is an LLM, really?");
    expect(status.classList.contains("shimmer")).toBe(true);
  });

  it("settles a tool into its existing static record when prose follows", () => {
    renderMessage(
      <ChatMessageBubble
        message={gardener(
          `${toolNote("web", "example.com")}\n\nHere is what I found.`,
        )}
        isStreaming
      />,
    );

    expect(screen.getByText("reading example.com")).toBeTruthy();
    expect(
      screen.getByText("Here is what I found.").classList.contains("shimmer"),
    ).toBe(false);
  });

  it("only shimmers the newest trailing tool", () => {
    renderMessage(
      <ChatMessageBubble
        message={gardener(
          `${toolNote("article", "what-is-an-llm")}\n\n${toolNote("web", "example.com")}`,
        )}
        isStreaming
      />,
    );

    expect(screen.getByText("reading")).toBeTruthy();
    const status = screen.getByText("Checking example.com");
    expect(status.classList.contains("shimmer")).toBe(true);
  });

  it("does not leave an activity shimmer on an error reply", () => {
    renderMessage(
      <ChatMessageBubble
        message={gardener("The Gardener could not answer just now.", true)}
        isStreaming
      />,
    );

    expect(screen.queryByText("The Gardener is thinking...")).toBeNull();
    expect(
      screen
        .getByText("The Gardener could not answer just now.")
        .classList.contains("shimmer"),
    ).toBe(false);
  });

  it("renders a diagram preview and opens a larger dialog", () => {
    const title = "How questions become answers";
    const diagram = "flowchart TD\n  A[Question] --> B[Answer]";
    renderMessage(
      <ChatMessageBubble
        message={gardener(diagramNote({ title, diagram }))}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: `Expand diagram: ${title}`,
    });
    expect(
      within(trigger).getByRole("img", { name: title }),
    ).toHaveAttribute("data-code", diagram);

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: title }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("img", { name: title }),
    ).toHaveAttribute("data-code", diagram);
  });
});
