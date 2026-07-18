import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMcpAuthContext: vi.fn(),
  getProject: vi.fn(),
  listProjectThreadsPage: vi.fn(),
  getThreadPage: vi.fn(),
}));

vi.mock("agents/mcp", () => ({ getMcpAuthContext: mocks.getMcpAuthContext }));

vi.mock("~/lib/projects.server", () => ({
  getProject: mocks.getProject,
  listProjectsPage: vi.fn(),
}));

vi.mock("~/lib/threads.server", () => ({
  getThreadPage: mocks.getThreadPage,
  listProjectThreadsPage: mocks.listProjectThreadsPage,
  parseContext: vi.fn(() => []),
}));

import { createGardenerMcpServer } from "~/lib/mcp/server.server";

const connectedServers: Array<ReturnType<typeof createGardenerMcpServer>> = [];

function env(): Env {
  return { APP_ORIGIN: "https://vibegarden.test" } as Env;
}

function project(id = "project-a") {
  return {
    id,
    title: "A project",
    oneLiner: null,
    status: "growing",
    moduleList: [],
    updatedAt: 1,
    threadId: null,
  };
}

function serverFor(userId: string) {
  mocks.getMcpAuthContext.mockReturnValue({
    props: { userId, scopes: ["projects:read", "content:read"] },
  });
  const server = createGardenerMcpServer(env());
  connectedServers.push(server);
  return server;
}

async function withClient<T>(
  server: ReturnType<typeof createGardenerMcpServer>,
  callback: (client: Client) => Promise<T>,
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "resources-prompts-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await callback(client);
  } finally {
    await client.close();
  }
}

async function listResourceTemplates(server: ReturnType<typeof createGardenerMcpServer>) {
  return withClient(server, async (client) => (await client.listResourceTemplates()).resourceTemplates);
}

async function listResources(server: ReturnType<typeof createGardenerMcpServer>) {
  return withClient(server, async (client) => (await client.listResources()).resources);
}

async function readResource(server: ReturnType<typeof createGardenerMcpServer>, uri: string) {
  return withClient(server, (client) => client.readResource({ uri }));
}

async function getPrompt(
  server: ReturnType<typeof createGardenerMcpServer>,
  name: string,
  args: Record<string, string>,
) {
  return withClient(server, (client) => client.getPrompt({ name, arguments: args }));
}

beforeEach(() => {
  mocks.getMcpAuthContext.mockReturnValue({
    props: { userId: "user-a", scopes: ["projects:read", "content:read"] },
  });
  mocks.getProject.mockResolvedValue(project());
  mocks.listProjectThreadsPage.mockResolvedValue({ items: [], nextPosition: undefined });
  mocks.getThreadPage.mockResolvedValue(null);
});

afterEach(async () => {
  await Promise.all(connectedServers.splice(0).map((server) => server.close()));
  vi.clearAllMocks();
});

describe("Gardener MCP resources and prompts", () => {
  it("discovers the five approved resource URIs", async () => {
    const server = serverFor("user-a");
    const templates = await listResourceTemplates(server);
    expect(templates.map((item) => item.uriTemplate)).toEqual([
      "vibegarden://project/{id}",
      "vibegarden://conversation/{id}",
      "vibegarden://article/{slug}",
      "vibegarden://module/{slug}",
    ]);
    const resources = await listResources(server);
    expect(resources.map((item) => item.uri)).toContain("vibegarden://guide/gardener");
  });

  it("enforces ownership on private resource reads", async () => {
    mocks.getProject.mockResolvedValue(null);

    await expect(readResource(
      serverFor("user-a"),
      "vibegarden://project/private-project",
    )).rejects.toMatchObject({ code: expect.anything() });
  });

  it("labels stored prompt-like text as user-authored context", async () => {
    mocks.getProject.mockResolvedValue(project("project-a"));
    mocks.listProjectThreadsPage.mockResolvedValue({
      items: [{
        id: "conversation-a",
        title: "Conversation",
        updatedAt: 2,
        messageCount: 1,
      }],
      nextPosition: undefined,
    });

    const prompt = await getPrompt(
      serverFor("user-a"),
      "continue_project",
      { project_id: "project-a" },
    );

    expect(JSON.stringify(prompt)).toContain("user-authored");
    expect(JSON.stringify(prompt)).toContain("smallest useful next step");
    expect(JSON.stringify(prompt)).not.toContain("system prompt");
  });
});
