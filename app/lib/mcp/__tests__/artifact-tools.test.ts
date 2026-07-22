import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTextArtifact,
  createTextArtifactVersion,
  shareArtifactVersionForScope,
} from "~/lib/artifacts/service.server";
import { runWithMcpRequestProps } from "~/lib/mcp/request-context.server";
import { createGardenerMcpServer } from "~/lib/mcp/server.server";

vi.mock("~/lib/artifacts/service.server", () => ({
  createTextArtifact: vi.fn(),
  createTextArtifactVersion: vi.fn(),
  shareArtifactVersionForScope: vi.fn(),
}));

vi.mock("agents/mcp", () => ({ getMcpAuthContext: vi.fn() }));

const connectedServers: Array<ReturnType<typeof createGardenerMcpServer>> = [];
const scope = { userId: "callback-user", clubId: "club-a" };
const expected = {
  artifact_id: "artifact-1",
  version_id: "version-1",
  visibility: "private",
  url: "https://vibegarden.test/clubs/wotf/artifacts/artifact-1",
};

function env(): Env {
  return {
    APP_ORIGIN: "https://vibegarden.test",
    SESSION_SECRET: "artifact-tool-test-secret",
    MCP_GENERAL_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    MCP_HISTORY_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ clubSlug: "wotf", clubName: "WOTF Club" })),
        })),
      })),
    },
  } as Env;
}

async function callTool(name: string, args: Record<string, unknown>, scopes: string[]) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "artifact-tool-test", version: "1.0.0" });
  const server = createGardenerMcpServer(env());
  connectedServers.push(server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await runWithMcpRequestProps({ ...scope, scopes }, () => client.callTool({ name, arguments: args }));
  } finally {
    await client.close();
  }
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(connectedServers.splice(0).map((server) => server.close()));
});

describe("MCP artifact tools", () => {
  it("creates a private HTML package for the trusted scope and returns only its canonical payload", async () => {
    vi.mocked(createTextArtifact).mockResolvedValue({ artifactId: "artifact-1", versionId: "version-1" });

    const result = await callTool("create_artifact", {
      project_id: "project-1",
      title: "Landing page",
      description: "A demo",
      allowed_data_origins: ["https://api.example.com"],
      idempotency_key: "create-1",
      files: [{ path: "index.html", content: "<h1>Hello</h1>", mime_type: "text/html" }],
    }, ["artifacts:write"]);

    expect(createTextArtifact).toHaveBeenCalledWith(expect.anything(), scope, {
      projectId: "project-1",
      type: "html",
      title: "Landing page",
      description: "A demo",
      allowedDataOrigins: ["https://api.example.com"],
      idempotencyKey: "create-1",
      files: [{ path: "index.html", content: "<h1>Hello</h1>", mimeType: "text/html" }],
    });
    expect(result.structuredContent).toEqual(expected);
    expect(JSON.parse(result.content[0].text)).toEqual(expected);
  });

  it("creates a version without mutable creation fields", async () => {
    vi.mocked(createTextArtifactVersion).mockResolvedValue({ artifactId: "artifact-1", versionId: "version-1" });

    const result = await callTool("create_artifact_version", {
      artifact_id: "artifact-1",
      idempotency_key: "version-1",
      files: [{ path: "index.html", content: "<h1>Revision</h1>" }],
    }, ["artifacts:write"]);

    expect(createTextArtifactVersion).toHaveBeenCalledWith(expect.anything(), scope, {
      artifactId: "artifact-1",
      idempotencyKey: "version-1",
      files: [{ path: "index.html", content: "<h1>Revision</h1>" }],
    });
    expect(result.structuredContent).toEqual(expected);
  });

  it("shares only a confirmed version for the trusted scope", async () => {
    vi.mocked(shareArtifactVersionForScope).mockResolvedValue(undefined);

    const result = await callTool("share_artifact", {
      artifact_id: "artifact-1",
      version_id: "version-1",
      confirm: true,
    }, ["artifacts:publish"]);

    expect(shareArtifactVersionForScope).toHaveBeenCalledWith(expect.anything(), scope, "artifact-1", "version-1");
    expect(result.structuredContent).toEqual({ ...expected, visibility: "gallery" });
  });
});
