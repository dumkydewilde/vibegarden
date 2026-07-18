import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Join from "../join";

function renderJoin(loaderData: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/join/:token",
      Component: Join,
      loader: () => loaderData,
    },
  ]);
  render(<Stub initialEntries={["/join/example-token"]} />);
}

describe("invite link join page", () => {
  it("renders the same neutral message for an unavailable invitation", async () => {
    renderJoin({ clubName: null, available: false });

    expect(
      await screen.findByText(
        "This invitation is no longer available. Ask a club administrator for a new one.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /join/i })).not.toBeInTheDocument();
  });

  it("shows the club name and requires explicit confirmation for an available link", async () => {
    renderJoin({ clubName: "Sunday Makers", available: true });

    expect(
      await screen.findByRole("heading", { name: /join sunday makers/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join sunday makers/i })).toBeInTheDocument();
  });
});
