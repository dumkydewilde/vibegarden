import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/workbench/memory.client", () => ({
  agentMemory: undefined,
}));
vi.mock("~/components/workbench/runner.client", () => ({
  createRunner: undefined,
}));

import AgentWorkbench from "../garden.agents.$id";

describe("Agent Workbench server rendering", () => {
  it("does not invoke client-only memory or runner exports", () => {
    const loaderData = {
      agent: {
        id: "agent-1",
        clubId: "club-1",
        ownerId: "owner-1",
        name: "SSR agent",
        description: "",
        visibility: "private",
        latestVersionId: "version-1",
        sharedVersionId: null,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
      version: {
        id: "version-1",
        agentId: "agent-1",
        definition: "{}",
        createdBy: "owner-1",
        createdAt: 1,
      },
      definition: {
        version: 1 as const,
        systemPrompt: "",
        tools: [],
        skills: [],
        builtins: { fetchPage: true, memory: true },
      },
      canEdit: false,
      runnerUrl: "https://usercontent.vibegarden.club/agent-runner",
      userId: "user-1",
      modelPrompt: "Model prompt",
    };

    expect(() =>
      renderToString(
        <MemoryRouter>
          <AgentWorkbench
            loaderData={loaderData}
            actionData={undefined}
            params={{ clubSlug: "garden-club", id: "agent-1" }}
            matches={[]}
          />
        </MemoryRouter>,
      ),
    ).not.toThrow();
  });
});
