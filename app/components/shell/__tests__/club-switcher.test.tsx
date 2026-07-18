import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ClubSwitcher } from "../club-switcher";

describe("ClubSwitcher", () => {
  it("marks the current club and always switches to a club home", async () => {
    render(
      <MemoryRouter>
        <ClubSwitcher
          current={{ name: "Current Club", slug: "current" }}
          clubs={[
            { name: "Current Club", slug: "current", role: "owner" },
            { name: "Second Club", slug: "second", role: "member" },
          ]}
        />
      </MemoryRouter>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: /current club/i }), {
      key: "ArrowDown",
    });

    expect(await screen.findByRole("menuitem", { name: /current club/i })).toHaveAttribute(
      "data-current",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: /second club/i })).toHaveAttribute(
      "href",
      "/clubs/second",
    );
  });

  it("exposes create and manage links and closes a mobile sheet after navigation", async () => {
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <ClubSwitcher
          compact
          current={{ name: "Current Club", slug: "current" }}
          clubs={[{ name: "Current Club", slug: "current", role: "owner" }]}
          onNavigate={onNavigate}
        />
      </MemoryRouter>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: /current club/i }), {
      key: "ArrowDown",
    });

    const create = await screen.findByRole("menuitem", { name: /create club/i });
    expect(create).toHaveAttribute("href", "/settings?create=1");
    expect(screen.getByRole("menuitem", { name: /manage clubs/i })).toHaveAttribute(
      "href",
      "/settings",
    );

    fireEvent.click(create);
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
