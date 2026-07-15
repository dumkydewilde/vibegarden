import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Inspiration from "../inspiration";

describe("Inspiration", () => {
  it("lists the 1950s kids games example with its live site", () => {
    render(<Inspiration />);

    const link = screen.getByRole("link", { name: /kids games/i });
    expect(link.getAttribute("href")).toBe(
      "http://kids-games-50s.pages.dev/",
    );
  });
});
