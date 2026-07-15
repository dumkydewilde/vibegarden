import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Admin from "../admin";

const loaderData = {
  users: [],
  invites: [],
  feedback: [],
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
