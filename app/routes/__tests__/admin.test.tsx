import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Admin from "../admin";

describe("Admin overview", () => {
  it("reports club AI availability without exposing secrets", async () => {
    const Stub = createRoutesStub([{ path: "/clubs/:clubSlug/admin", Component: Admin, loader: () => ({
      club: { name: "WOTF", slug: "wotf" }, ai: { provisioningState: "ready", syncedPolicy: "free_only" }, isOwner: true, feedback: [],
      conversations: [{ id: "thread-1", title: "Build a reading tracker", updatedAt: Date.UTC(2026, 6, 16), messageCount: 4, participant: { name: "Ada Lovelace", email: "ada@example.com" } }],
    }) }]);
    render(<Stub initialEntries={["/clubs/wotf/admin"]} />);
    expect(await screen.findByText("AI availability")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.queryByText(/openrouter/i)).not.toBeInTheDocument();
  });
});
