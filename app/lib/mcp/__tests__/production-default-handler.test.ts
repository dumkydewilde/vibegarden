import { describe, expect, it, vi } from "vitest";
import { MCP_SCOPES } from "../contracts";

vi.mock("~/lib/club-ai.server", () => ({ reconcileClubAi: vi.fn() }));
vi.mock("~/lib/artifacts/cleanup.server", () => ({ cleanupArtifacts: vi.fn() }));
vi.mock("~/lib/artifacts/observability.server", () => ({ recordArtifactEvent: vi.fn(), writeArtifactMetric: vi.fn() }));
vi.mock("../../../../workers/oauth", () => ({ createOAuthProvider: vi.fn(), isOAuthProviderPath: vi.fn() }));
vi.mock("../../../../workers/mcp", () => ({ mcpOriginAllowed: vi.fn(), mcpOriginRejectedResponse: vi.fn() }));
vi.mock("../../../../workers/react-router", () => ({ reactRouterHandler: { fetch: vi.fn() } }));

const { createMcpDefaultHandler } = await import("../../../../workers/app");

describe("production MCP default handler", () => {
  it("advertises every supported MCP scope in its unauthenticated challenge", async () => {
    const response = await createMcpDefaultHandler("/mcp").fetch(
      new Request("https://vibegarden.club/mcp"),
      { APP_ORIGIN: "https://vibegarden.club" } as Env,
      {} as ExecutionContext,
    );

    expect(response.headers.get("WWW-Authenticate")).toContain(
      `scope="${MCP_SCOPES.join(" ")}"`,
    );
  });
});
