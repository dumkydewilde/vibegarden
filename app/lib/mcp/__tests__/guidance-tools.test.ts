import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithMcpRequestProps } from "~/lib/mcp/request-context.server";
import { createGardenerMcpServer } from "~/lib/mcp/server.server";

vi.mock("~/lib/projects.server", () => ({
  getProject: vi.fn(),
  listProjectsPage: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("~/lib/threads.server", () => ({
  getThreadPage: vi.fn(),
  listProjectThreadsPage: vi.fn(),
  parseContext: vi.fn(() => []),
}));

vi.mock("agents/mcp", () => ({ getMcpAuthContext: vi.fn() }));

const connectedServers: Array<ReturnType<typeof createGardenerMcpServer>> = [];

function env(): Env {
  return {
    APP_ORIGIN: "https://vibegarden.test",
    SESSION_SECRET: "guidance-tool-test-secret",
    MCP_GENERAL_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    MCP_HISTORY_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ clubSlug: "wotf", clubName: "WOTF Club" })),
        })),
      })),
    },
  } as unknown as Env;
}

async function withClient<T>(
  callback: (client: Client) => Promise<T>,
  scopes: string[] = ["content:read"],
): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "guidance-tool-test", version: "1.0.0" });
  const server = createGardenerMcpServer(env());
  connectedServers.push(server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await runWithMcpRequestProps(
      { userId: "guidance-user", clubId: "club-a", scopes },
      () => callback(client),
    );
  } finally {
    await client.close();
  }
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(connectedServers.splice(0).map((server) => server.close()));
});

describe("MCP guidance tool", () => {
  it("advertises itself as a read-only content tool with usable guidance", async () => {
    const tools = await withClient(async (client) => (await client.listTools()).tools);
    const guidance = tools.find((tool) => tool.name === "get_guidance");

    expect(guidance).toBeDefined();
    expect(guidance!.annotations).toMatchObject({ readOnlyHint: true });
    expect(guidance!._meta).toMatchObject({
      securitySchemes: [{ type: "oauth2", scopes: ["content:read"] }],
    });
    expect(guidance!.description).toMatch(/read_article|read_module/);
    expect(guidance!.inputSchema).toMatchObject({
      required: ["question"],
      additionalProperties: false,
    });
  });

  it("answers a hosting question from the library in one call", async () => {
    const result = await withClient((client) => client.callTool({
      name: "get_guidance",
      arguments: { question: "where should I put the images people upload?" },
    })) as {
      structuredContent: {
        items: Array<{ slug: string; excerpt: string; url: string }>;
        related: Array<{ slug: string }>;
      };
      content: Array<{ text: string }>;
    };

    expect(result.structuredContent.items.map((item) => item.slug))
      .toContain("hosting-files-and-assets");
    const [top] = result.structuredContent.items;
    expect(top.excerpt.length).toBeGreaterThan(200);
    expect(top.url).toBe(
      "https://vibegarden.test/clubs/wotf/learning/hosting-files-and-assets",
    );
    expect(result.content[0].text).toMatch(/hosting-files-and-assets/);
  });

  it("says so plainly when nothing matched, and still points somewhere", async () => {
    const result = await withClient((client) => client.callTool({
      name: "get_guidance",
      arguments: { question: "qqzzx wibblefrotz zzyxwv" },
    })) as {
      structuredContent: { items: unknown[]; related: unknown[] };
      content: Array<{ text: string }>;
    };

    expect(result.structuredContent.items).toEqual([]);
    expect(result.structuredContent.related.length).toBeGreaterThan(1);
    expect(result.content[0].text).toMatch(/no direct match/i);
  });

  it("challenges a caller without the content scope", async () => {
    const result = await withClient(
      (client) => client.callTool({
        name: "get_guidance",
        arguments: { question: "how do I host my data?" },
      }),
      ["projects:read"],
    ) as { isError?: boolean; _meta?: Record<string, unknown> };

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("insufficient_scope");
    expect(JSON.stringify(result._meta)).toContain("content:read");
  });
});

describe("MCP library resource and plan_build prompt", () => {
  it("publishes the whole library as one browsable resource", async () => {
    const resources = await withClient(async (client) => (await client.listResources()).resources);
    expect(resources.map((item) => item.uri)).toContain("vibegarden://guide/library");

    const guide = await withClient((client) => client.readResource({
      uri: "vibegarden://guide/library",
    }));
    const text = guide.contents[0]?.text as string;

    expect(text).toContain("## Learning articles");
    expect(text).toContain("## Building blocks");
    expect(text).toContain("hosting-files-and-assets");
    expect(text).toContain("api-connection");
    expect(guide.contents[0]?.mimeType).toBe("text/markdown");
  });

  it("plans a build from the matched material without impersonating the Gardener", async () => {
    const prompt = await withClient((client) => client.getPrompt({
      name: "plan_build",
      arguments: { goal: "a dashboard of my expenses from a CSV" },
    }));
    const serialized = JSON.stringify(prompt);

    expect(serialized).toMatch(/building block/i);
    expect(serialized).toMatch(/smallest useful/i);
    expect(serialized).toMatch(/do not claim to be/i);
    expect(serialized).toContain("vibegarden://");
    expect(prompt.messages.length).toBeGreaterThan(2);
  });

  it("requires the content scope for the library resource", async () => {
    await expect(withClient(
      (client) => client.readResource({ uri: "vibegarden://guide/library" }),
      ["projects:read"],
    )).rejects.toMatchObject({
      data: {
        _meta: {
          "mcp/www_authenticate": [expect.stringContaining("insufficient_scope")],
        },
      },
    });
  });
});
