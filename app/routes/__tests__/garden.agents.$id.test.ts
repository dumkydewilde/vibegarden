import { afterEach, describe, expect, it, vi } from "vitest";
import { capCallResult } from "@vibegarden/agent-web";

import type { AgentDefinition } from "~/lib/agents/contracts";
import {
  createWorkbenchWiring,
  fetchWorkbenchPage,
  type FetchWorkbenchPageResult,
} from "../garden.agents.$id";

const definition: AgentDefinition = {
  version: 1,
  systemPrompt: "Use the available tools.",
  tools: [
    {
      name: "extract_title",
      description: "Extract a page title.",
      parameters: { type: "object" },
      source: "return args.title;",
    },
  ],
  skills: [],
  builtins: { fetchPage: true, memory: true },
};

const fetchedPage: FetchWorkbenchPageResult = {
  status: 200,
  contentType: "text/html; charset=utf-8",
  body: "<title>Workbench</title>",
  totalChars: 24,
  truncated: false,
};

function memory() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  };
}

describe("Agent Workbench executor wiring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates and returns the complete fetch proxy payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fetchedPage));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWorkbenchPage("garden club", "https://example.com/guide"),
    ).resolves.toEqual(fetchedPage);
    expect(fetchMock).toHaveBeenCalledWith(
      "/clubs/garden%20club/api/fetch-proxy",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/guide" }),
      }),
    );
  });

  it.each([
    { ...fetchedPage, status: "200" },
    { ...fetchedPage, contentType: null },
    { ...fetchedPage, body: null },
    { ...fetchedPage, totalChars: fetchedPage.body.length - 1 },
    { ...fetchedPage, truncated: "no" },
    { ...fetchedPage, unexpected: true },
  ])("rejects an invalid fetch proxy payload", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));

    await expect(
      fetchWorkbenchPage("garden-club", "https://example.com/guide"),
    ).rejects.toThrow("The fetch proxy returned an invalid response.");
  });

  it("passes full fetch metadata to runner tools and only page text to the direct executor", async () => {
    const fetchPage = vi.fn().mockResolvedValue(fetchedPage);
    const wiring = createWorkbenchWiring({
      definition,
      fetchPage,
      memory: memory(),
      getRunner: () => null,
    });

    await expect(
      wiring.host.fetchPage("https://example.com/guide"),
    ).resolves.toEqual(fetchedPage);
    await expect(
      wiring.executors.fetch_page!({
        tool: "fetch_page",
        args: { url: "https://example.com/guide" },
      }),
    ).resolves.toEqual({
      raw: fetchedPage.body,
      envelope: capCallResult(fetchedPage.body),
    });
  });

  it("keeps a bounded failed runner result and its logs in raw output only", async () => {
    const error = "e".repeat(1_100);
    const log = "l".repeat(600);
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: false as const,
        error,
        logs: [log, "cleanup ran"],
      }),
    };
    const wiring = createWorkbenchWiring({
      definition,
      fetchPage: vi.fn().mockResolvedValue(fetchedPage),
      memory: memory(),
      getRunner: () => runner,
    });

    const execution = await wiring.fallbackExecutor({
      tool: "extract_title",
      args: { title: "Workbench" },
    });

    expect(execution.envelope).toEqual({
      status: "error",
      error: "e".repeat(1_000),
    });
    expect(execution).toHaveProperty(
      "raw",
      `Runner error:\n${"e".repeat(1_000)}\n\nRunner logs:\n${"l".repeat(500)}\ncleanup ran`,
    );
    expect(JSON.stringify(execution.envelope)).not.toContain("cleanup ran");
    expect(runner.run).toHaveBeenCalledWith(
      "return args.title;",
      { title: "Workbench" },
    );
  });
});
