import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentSidebar } from "../agent-sidebar";

vi.mock("~/components/gardener/gardener-provider", () => ({
  useGardener: () => ({ open: false, setOpen: vi.fn() }),
}));

vi.mock("~/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

describe("AgentSidebar launcher", () => {
  it("sits above and left of the viewport corner with a pointer cursor", () => {
    render(<AgentSidebar />);

    const launcher = screen.getByRole("button", { name: "Ask the Gardener" });
    expect(launcher).toHaveClass("right-6", "bottom-8", "cursor-pointer");
  });
});
