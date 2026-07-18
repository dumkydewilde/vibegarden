import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Admin from "../admin";

describe("club administration overview", () => {
  it("links admins to scoped members, invitations, and settings sections", async () => {
    const Stub = createRoutesStub([
      {
        path: "/clubs/:clubSlug/admin",
        Component: Admin,
        loader: () => ({
          club: { name: "WOTF", slug: "wotf" },
          ai: null,
          isOwner: true,
          feedback: [],
          conversations: [],
        }),
      },
    ]);
    render(<Stub initialEntries={["/clubs/wotf/admin"]} />);

    expect(await screen.findByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/clubs/wotf/admin/members",
    );
    expect(screen.getByRole("link", { name: "Invitations" })).toHaveAttribute(
      "href",
      "/clubs/wotf/admin/invitations",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/clubs/wotf/admin/settings",
    );
  });
});
