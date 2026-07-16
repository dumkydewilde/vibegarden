import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Admin from "../admin";

const loaderData = {
  users: [],
  invites: [],
  feedback: [],
  conversations: [
    {
      id: "thread-1",
      title: "Build a reading tracker",
      updatedAt: Date.UTC(2026, 6, 16),
      messageCount: 4,
      participant: {
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
    },
  ],
};

function renderAdmin(action: () => unknown = () => ({ ok: true })) {
  const Stub = createRoutesStub([
    {
      path: "/admin",
      Component: Admin,
      loader: () => loaderData,
      action,
    },
  ]);
  render(<Stub initialEntries={["/admin"]} />);
}

describe("Admin bulk invites", () => {
  it("offers pasted addresses and a CSV upload", async () => {
    renderAdmin();

    expect(
      await screen.findByRole("textbox", { name: /email addresses/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/csv file/i)).toHaveAttribute(
      "accept",
      ".csv,text/csv,text/plain",
    );
    expect(
      screen.getByRole("button", { name: /invite everyone/i }),
    ).toBeInTheDocument();
  });

  it("reports imported, duplicate, and rejected addresses", async () => {
    renderAdmin(() => ({
      bulk: {
        imported: 2,
        accepted: ["alice@example.com", "bob@example.com"],
        duplicates: ["alice@example.com"],
        rejected: [
          { value: "not-an-email", reason: "Invalid email address" },
        ],
      },
    }));

    const textarea = await screen.findByRole("textbox", {
      name: /email addresses/i,
    });
    fireEvent.change(textarea, { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /invite everyone/i }));

    expect(await screen.findByText("2 addresses invited")).toBeInTheDocument();
    expect(screen.getByText("1 duplicate skipped")).toBeInTheDocument();
    expect(screen.getByText(/not-an-email/)).toHaveTextContent(
      "Invalid email address",
    );
  });
});

describe("Admin single invites", () => {
  it("confirms the email address after an invite is sent", async () => {
    renderAdmin(() => ({ ok: true, invitedEmail: "alice@example.com" }));

    fireEvent.change(await screen.findByPlaceholderText("friend@example.com"), {
      target: { value: "Alice@Example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(
      await screen.findByText("Invite sent for alice@example.com"),
    ).toBeInTheDocument();
  });
});

describe("Admin Gardener conversations", () => {
  it("links each participant conversation to its read-only transcript", async () => {
    renderAdmin();

    expect(
      await screen.findByRole("heading", { name: /gardener conversations/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Build a reading tracker")).toBeInTheDocument();
    expect(screen.getByText(/4 messages/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /build a reading tracker/i })).toHaveAttribute(
      "href",
      "/admin/conversations/thread-1",
    );
  });
});
