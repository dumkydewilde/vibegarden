import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_TOOL_ORDER } from "~/lib/mcp/contracts";
import { runWithMcpRequestProps } from "~/lib/mcp/request-context.server";
import { createGardenerMcpServer } from "~/lib/mcp/server.server";

vi.mock("~/lib/projects.server", () => ({
  createProject: vi.fn(),
  getProject: vi.fn(),
  listProjectsPage: vi.fn(),
  updateProject: vi.fn(),
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
      expect(item._meta).toMatchObject({
        securitySchemes: [expect.objectContaining({ type: "oauth2" })],
      });
    }
    const mutations = [
      "create_project",
      "update_project",
      "create_artifact",
      "create_artifact_version",
      "share_artifact",
    ];
    for (const name of MCP_TOOL_ORDER.filter((name) => (
      name !== "fresh_reads" && !mutations.includes(name)
    ))) {
      expect(tool(tools, name).annotations).toMatchObject({ readOnlyHint: true });
    }
  });

  it("marks project writes as bounded, idempotent, and non-destructive", async () => {
    const tools = await listTools(createGardenerMcpServer(env()));
    const create = tool(tools, "create_project");
    const update = tool(tools, "update_project");

    for (const item of [create, update]) {
      expect(item.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(item._meta).toMatchObject({
        securitySchemes: [expect.objectContaining({ scopes: ["projects:write"] })],
      });
    }
    expect(create.description).toMatch(/idempotency key/i);
    expect(create.description).toMatch(/only when the person asks/i);
    expect(update.description).toMatch(/omitted fields/i);
    expect(tools.map((item) => item.name)).not.toContain("delete_project");
  });

  it("keeps project write inputs bounded and closed", async () => {
    const tools = await listTools(createGardenerMcpServer(env()));

    expect(tool(tools, "create_project").inputSchema).toMatchObject({
      type: "object",
      required: ["title", "idempotency_key"],
      additionalProperties: false,
      properties: {
        title: { maxLength: 120 },
        one_liner: { maxLength: 300 },
        notes: { maxLength: 4_000 },
      },
    });
    expect(tool(tools, "update_project").inputSchema).toMatchObject({
      type: "object",
      required: ["project_id"],
      additionalProperties: false,
      properties: { status: { enum: ["seed", "growing", "bloomed"] } },
    });
  });

  it("marks artifact mutations accurately and gives safe package guidance", async () => {
    const tools = await listTools(createGardenerMcpServer(env()));
    const create = tool(tools, "create_artifact");
    const version = tool(tools, "create_artifact_version");
    const share = tool(tools, "share_artifact");

    expect(create.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(version.annotations).toEqual(create.annotations);
    expect(share.annotations).toEqual({ ...create.annotations, openWorldHint: true });
    expect(create.inputSchema).toMatchObject({
      type: "object",
      required: ["project_id", "title", "idempotency_key"],
      additionalProperties: false,
      properties: {
        type: { enum: ["html", "link"] },
        files: { type: "array" },
        url: { type: "string" },
      },
    });
    expect(version.inputSchema).toMatchObject({
      type: "object",
      required: ["artifact_id", "idempotency_key"],
      properties: { files: { type: "array" }, url: { type: "string" } },
    });
    expect(version.inputSchema.properties).not.toHaveProperty("type");
    for (const description of [create.description, version.description]) {
      expect(description).toMatch(/index\.html/i);
      expect(description).toMatch(/private/i);
      expect(description).toMatch(/relative/i);
      expect(description).toMatch(/idempotency/i);
    }
    expect(share.description).toMatch(/explicitly asks to share/i);
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
