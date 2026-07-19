import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_TOOL_ORDER } from "~/lib/mcp/contracts";
import { runWithMcpRequestProps } from "~/lib/mcp/request-context.server";
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
    SESSION_SECRET: "tool-discovery-test-secret",
    MCP_GENERAL_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    MCP_HISTORY_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ clubSlug: "wotf", clubName: "WOTF Club" })),
        })),
      })),
    },
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

async function callTool(
  server: ReturnType<typeof createGardenerMcpServer>,
  name: string,
  args: Record<string, unknown>,
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tool-callback-test", version: "1.0.0" });
  connectedServers.push(server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await runWithMcpRequestProps(
      { userId: "callback-user", clubId: "club-a", scopes: ["content:read"] },
      () => client.callTool({ name, arguments: args }),
    );
  } finally {
    await client.close();
  }
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

    expect(tools.map((item) => item.name)).toEqual(MCP_TOOL_ORDER.filter((name) => name !== "fresh_reads"));
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
      .map((item) => item.name)).toEqual(MCP_TOOL_ORDER);
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

  it("dispatches a registered callback through the MCP protocol", async () => {
    const result = await callTool(
      createGardenerMcpServer(env()),
      "list_learning_content",
      { page_size: 1 },
    );

    expect(result).toMatchObject({
      structuredContent: { items: [expect.any(Object)] },
      content: [{ type: "text", text: "Learning content returned." }],
    });
  });
});
