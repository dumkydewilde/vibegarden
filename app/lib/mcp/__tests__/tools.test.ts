import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGardenerMcpServer } from "~/lib/mcp/server.server";

vi.mock("~/lib/projects.server", () => ({
  getProject: vi.fn(),
  listProjectsPage: vi.fn(),
}));

vi.mock("~/lib/threads.server", () => ({
  getThreadPage: vi.fn(),
  listProjectThreadsPage: vi.fn(),
  parseContext: vi.fn(),
}));

vi.mock("agents/mcp", () => ({ getMcpAuthContext: vi.fn() }));

const connectedServers: Array<ReturnType<typeof createGardenerMcpServer>> = [];

function env(overrides: Partial<Env> = {}): Env {
  return {
    APP_ORIGIN: "https://vibegarden.test",
    ...overrides,
  } as Env;
}

async function listTools(server: ReturnType<typeof createGardenerMcpServer>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tool-discovery-test", version: "1.0.0" });
  connectedServers.push(server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.listTools();
  await client.close();
  return result.tools;
}

function tool<T extends { name: string }>(tools: T[], name: string): T {
  const result = tools.find((candidate) => candidate.name === name);
  if (!result) throw new Error(`Missing tool ${name}`);
  return result;
}

afterEach(async () => {
  await Promise.all(connectedServers.splice(0).map((server) => server.close()));
});

describe("Gardener MCP tool registration", () => {
  it("discovers tools in stable order with complete metadata", async () => {
    const tools = await listTools(createGardenerMcpServer(env()));

    expect(tools.map((item) => item.name)).toEqual([
      "list_projects",
      "get_project",
      "list_project_conversations",
      "get_conversation",
      "list_learning_content",
      "read_article",
      "read_module",
      "search",
      "fetch",
    ]);
    for (const item of tools) {
      expect(item.title).toEqual(expect.any(String));
      expect(item.inputSchema).toMatchObject({ type: "object" });
      expect(item.outputSchema).toMatchObject({ type: "object" });
      expect(item.annotations).toMatchObject({ readOnlyHint: true });
      expect(item._meta).toMatchObject({
        securitySchemes: [expect.objectContaining({ type: "oauth2" })],
      });
    }
  });

  it("registers fresh_reads only with its backend", async () => {
    expect((await listTools(createGardenerMcpServer(env())))
      .map((item) => item.name)).not.toContain("fresh_reads");
    expect((await listTools(createGardenerMcpServer(env({ MOTHERDUCK_TOKEN: "test-token" }))))
      .map((item) => item.name)).toContain("fresh_reads");
  });

  it("keeps search and fetch inputs exact", async () => {
    const tools = await listTools(createGardenerMcpServer(env()));

    expect(tool(tools, "search").inputSchema).toMatchObject({
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" } },
      additionalProperties: false,
    });
    expect(tool(tools, "fetch").inputSchema).toMatchObject({
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false,
    });
  });
});
