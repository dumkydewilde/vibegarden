import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const joinWithInviteLink = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth.server", () => ({ getUser }));
vi.mock("~/lib/invites.server", () => ({
  getInvitePreview: vi.fn(),
  joinWithInviteLink,
}));

import Join, { action } from "../join";

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
  it("redirects into the club after a successful join", async () => {
    getUser.mockResolvedValue({ id: "member" });
    joinWithInviteLink.mockResolvedValue({
      ok: true,
      clubSlug: "sunday-makers",
    });

    const response = await action({
      request: new Request("https://garden.test/join/example-token", {
        method: "POST",
      }),
      params: { token: "example-token" },
      context: { get: () => ({ env: {} }) },
    } as never);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe(
      "/clubs/sunday-makers",
    );
  });

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
