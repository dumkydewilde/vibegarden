import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMcpAuthContext: vi.fn(),
  getProject: vi.fn(),
  listProjectThreadsPage: vi.fn(),
  getThreadPage: vi.fn(),
  generalLimit: vi.fn(),
  historyLimit: vi.fn(),
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
  return {
    APP_ORIGIN: "https://vibegarden.test",
    SESSION_SECRET: "resource-prompt-test-secret",
    MCP_GENERAL_LIMITER: { limit: mocks.generalLimit },
    MCP_HISTORY_LIMITER: { limit: mocks.historyLimit },
  } as Env;
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

function serverFor(userId: string, scopes = ["projects:read", "content:read"]) {
  mocks.getMcpAuthContext.mockReturnValue({
    props: { userId, scopes },
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
  mocks.generalLimit.mockResolvedValue({ success: true });
  mocks.historyLimit.mockResolvedValue({ success: true });
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

  it("uses the verified caller for foreign project resource lookups without disclosing ownership", async () => {
    mocks.getProject.mockImplementation(async (_env, userId: string, projectId: string) => (
      userId === "user-b" && projectId === "private-project"
        ? project(projectId)
        : null
    ));

    await expect(readResource(
      serverFor("user-a"),
      "vibegarden://project/private-project",
    )).rejects.toMatchObject({
      message: expect.not.stringContaining("user-b"),
    });
    expect(mocks.getProject).toHaveBeenCalledWith(
      expect.anything(),
      "user-a",
      "private-project",
    );
  });

  it("rejects a resource response whose text body exceeds the MCP cap", async () => {
    mocks.getProject.mockResolvedValue({ ...project(), title: "x".repeat(20_001) });

    await expect(readResource(
      serverFor("user-a"),
      "vibegarden://project/project-a",
    )).rejects.toMatchObject({ code: expect.anything() });
  });

  it("rejects a prompt response whose serialized body exceeds the MCP cap", async () => {
    mocks.getProject.mockResolvedValue({ ...project(), title: "x".repeat(100_001) });

    await expect(getPrompt(
      serverFor("user-a"),
      "continue_project",
      { project_id: "project-a" },
    )).rejects.toMatchObject({ code: expect.anything() });
  });

  it("redacts unexpected resource failures and logs no response content", async () => {
    const attackerText = "resource database password: do-not-expose";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getProject.mockRejectedValue(new Error(attackerText));

    await expect(readResource(
      serverFor("user-a"),
      "vibegarden://project/project-a",
    )).rejects.toMatchObject({
      message: expect.not.stringContaining(attackerText),
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(attackerText);
    consoleError.mockRestore();
  });

  it("preserves an OAuth challenge when a resource scope is missing", async () => {
    await expect(readResource(
      serverFor("user-a", ["projects:read"]),
      "vibegarden://article/what-is-an-llm",
    )).rejects.toMatchObject({
      data: {
        _meta: {
          "mcp/www_authenticate": [expect.stringContaining("insufficient_scope")],
        },
      },
    });
  });

  it("applies the shared rate limit to prompt invocations", async () => {
    mocks.generalLimit.mockResolvedValue({ success: false });

    await expect(getPrompt(
      serverFor("user-a"),
      "continue_project",
      { project_id: "project-a" },
    )).rejects.toMatchObject({
      data: { error: { code: "rate_limited" } },
    });
    expect(mocks.generalLimit).toHaveBeenCalledWith({
      key: expect.stringMatching(/:continue_project$/),
    });
  });

  it("uses the history limiter for conversation resource reads", async () => {
    mocks.getThreadPage.mockResolvedValue({
      thread: { id: "conversation-a", title: "Conversation", updatedAt: 2, createdAt: 1 },
      messages: [],
    });

    await readResource(serverFor("user-a"), "vibegarden://conversation/conversation-a");

    expect(mocks.historyLimit).toHaveBeenCalledWith({
      key: expect.stringMatching(/:read_conversation_resource$/),
    });
    expect(mocks.generalLimit).not.toHaveBeenCalled();
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
