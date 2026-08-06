import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CallCard } from "../call-card";

describe("CallCard", () => {
  it("renders a tool call name and its formatted arguments", () => {
    render(
      <CallCard
        segment={{
          type: "call",
          tool: "fetch_page",
          args: { url: "https://example.com/guide", mode: "readable" },
        }}
      />,
    );

    expect(screen.getByText("fetch_page")).toBeInTheDocument();
    expect(screen.getByText(/"url": "https:\/\/example.com\/guide"/)).toBeInTheDocument();
    expect(screen.getByText(/"mode": "readable"/)).toBeInTheDocument();
  });

  it("keeps the full raw result visible and labels the capped model view", () => {
    render(
      <CallCard
        segment={{
          type: "callresult",
          result: {
            status: "ok",
            resultText: "A capped page excerpt",
            totalChars: 212_340,
            truncated: true,
          },
        }}
        raw="<html>the complete fetched page</html>"
      />,
    );

    expect(
      screen.getByText("212,340 chars fetched, the model saw 21"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("<html>the complete fetched page</html>"),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Sent to model" }));
    expect(screen.getByText("A capped page excerpt")).toBeVisible();
  });

  it("renders a tool error prominently in the sent-to-model view", () => {
    render(
      <CallCard
        segment={{
          type: "callresult",
          result: { status: "error", error: "The target refused access." },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Sent to model" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The target refused access.",
    );
  });
});
