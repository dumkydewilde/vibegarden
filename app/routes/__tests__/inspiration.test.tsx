import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Inspiration from "../inspiration";

function renderInspiration() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: Inspiration,
      loader: () => ({ commentsByTarget: {}, canModerate: false }),
      action: () => ({ ok: true }),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

describe("Inspiration", () => {
  it("lists the 1950s kids games example with its live site", async () => {
    renderInspiration();

    const link = await screen.findByRole("link", { name: /kids games/i });
    expect(link.getAttribute("href")).toBe(
      "http://kids-games-50s.pages.dev/",
    );
  });

  it("offers a discussion on cards", async () => {
    renderInspiration();

    const discuss = await screen.findAllByRole("button", {
      name: /discuss/i,
    });
    expect(discuss.length).toBeGreaterThan(0);
  });
});
