import { describe, expect, it } from "vitest";
import { MCP_SCOPES, MCP_TOOL_ORDER, clampPageSize } from "~/lib/mcp/contracts";

describe("MCP contracts", () => {
  it("keeps scopes and discovery order stable", () => {
    expect(MCP_SCOPES).toEqual(["projects:read", "content:read"]);
    expect(MCP_TOOL_ORDER).toEqual([
      "list_projects",
      "get_project",
      "list_project_conversations",
      "get_conversation",
      "list_learning_content",
      "read_article",
      "read_module",
      "fresh_reads",
      "search",
      "fetch",
    ]);
  });

  it("uses separate list and conversation caps", () => {
    expect(clampPageSize(undefined, "list")).toBe(20);
    expect(clampPageSize(500, "list")).toBe(50);
    expect(clampPageSize(undefined, "conversation")).toBe(50);
    expect(clampPageSize(500, "conversation")).toBe(100);
  });
});
