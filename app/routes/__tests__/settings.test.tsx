import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Settings, { action } from "../settings";
import { createClub, listUserClubs } from "~/lib/clubs.server";
import { requireUser } from "~/lib/auth.server";
import { leaveClub } from "~/lib/memberships.server";

vi.mock("~/lib/auth.server", () => ({ requireUser: vi.fn() }));
vi.mock("~/lib/clubs.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/clubs.server")>()),
  createClub: vi.fn(),
  listUserClubs: vi.fn(),
}));
vi.mock("~/lib/memberships.server", () => ({ leaveClub: vi.fn() }));

const loaderData = {
  user: { name: "Ada", email: "ada@example.com", themePref: "system" },
  clubs: [
    {
      club: { id: "active", name: "Active Club", slug: "active", status: "active" },
      membership: { userId: "user-1", role: "member" },
    },
    {
      club: { id: "owned", name: "Owned Club", slug: "owned", status: "active" },
      membership: { userId: "user-1", role: "owner" },
    },
    {
      club: { id: "archived", name: "Old Club", slug: "old", status: "archived" },
      membership: { userId: "user-1", role: "admin" },
    },
  ],
};

function renderSettings() {
  const Stub = createRoutesStub([
    {
      path: "/settings",
      Component: Settings,
      loader: () => loaderData,
      action: () => ({ ok: true }),
    },
  ]);
  render(<Stub initialEntries={["/settings?create=1"]} />);
}

function actionArgs(formData: FormData) {
  return {
    request: new Request("https://example.com/settings", {
      method: "POST",
      body: formData,
    }),
    context: { get: () => ({ env: { DB: { prepare: vi.fn() } } as unknown as Env }) },
    params: {},
  } as never;
}

describe("global settings", () => {
  it("edits a proposed club slug and describes memberships without linking archived clubs", async () => {
    renderSettings();

    expect(await screen.findByRole("textbox", { name: /club url/i })).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox", { name: /club name/i }), {
      target: { value: "My Test Club" },
    });
    expect(screen.getByRole("textbox", { name: /club url/i })).toHaveValue("my-test-club");
    fireEvent.change(screen.getByRole("textbox", { name: /club url/i }), {
      target: { value: "my-own-slug" },
    });
    expect(screen.getByRole("textbox", { name: /club url/i })).toHaveValue("my-own-slug");

    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText(/admin · archived/i)).toBeInTheDocument();
    expect(screen.getByText(/transfer ownership before leaving/i)).toBeInTheDocument();
    expect(screen.getByText("Old Club").closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: "Active Club" })).toHaveAttribute(
      "href",
      "/clubs/active",
    );
  });

  it("persists a global theme preference", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as never);
    const run = vi.fn().mockResolvedValue({});
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ run })) }));
    const data = new FormData();
    data.set("intent", "theme");
    data.set("theme", "dark");

    await expect(
      action({
        ...actionArgs(data),
        context: { get: () => ({ env: { DB: { prepare } } as unknown as Env }) },
      }),
    ).resolves.toEqual({ ok: true, intent: "theme", theme: "dark" });
    expect(prepare).toHaveBeenCalledWith("UPDATE users SET theme_pref = ? WHERE id = ?");
  });

  it("redirects to a newly created club without waiting for AI provisioning", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(createClub).mockResolvedValue({ slug: "new-club" } as never);
    const data = new FormData();
    data.set("intent", "create-club");
    data.set("name", "New Club");
    data.set("slug", "new-club");

    const response = await action(actionArgs(data));
    expect(response).toMatchObject({ status: 302, headers: expect.any(Headers) });
    expect((response as Response).headers.get("Location")).toBe("/clubs/new-club");
  });

  it("returns a creation error without changing another club", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(createClub).mockRejectedValue(new Error("batch failed"));
    const data = new FormData();
    data.set("intent", "create-club");
    data.set("name", "New Club");
    data.set("slug", "new-club");

    await expect(action(actionArgs(data))).resolves.toEqual({
      error: "The club could not be created. Your other clubs were not changed.",
      intent: "create-club",
    });
    expect(listUserClubs).not.toHaveBeenCalled();
  });

  it("returns an inline error for an invalid club URL", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(createClub).mockRejectedValue(new Response("Invalid club slug", { status: 400 }));
    const data = new FormData();
    data.set("intent", "create-club");
    data.set("name", "New Club");
    data.set("slug", "a");

    await expect(action(actionArgs(data))).resolves.toEqual({
      error: "Choose a valid club URL.",
      intent: "create-club",
    });
  });

  it("rejects an owner leave request before calling membership lifecycle code", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(listUserClubs).mockResolvedValue([
      {
        club: { id: "owned", name: "Owned Club", slug: "owned", status: "active" },
        membership: { userId: "user-1", role: "owner" },
      },
    ] as never);
    const data = new FormData();
    data.set("intent", "leave-club");
    data.set("clubId", "owned");

    await expect(action(actionArgs(data))).rejects.toMatchObject({ status: 409 });
    expect(vi.mocked(leaveClub)).not.toHaveBeenCalled();
  });
});
