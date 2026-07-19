import { describe, expect, it } from "vitest";
import {
  getMcpRequestProps,
  runWithMcpRequestProps,
} from "~/lib/mcp/request-context.server";

describe("MCP request context", () => {
  it("keeps interleaved request props isolated across awaited work", async () => {
    const [first, second] = await Promise.all([
      runWithMcpRequestProps({ userId: "first", scopes: ["projects:read"] }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getMcpRequestProps();
      }),
      runWithMcpRequestProps({ userId: "second", scopes: ["content:read"] }, async () => {
        await Promise.resolve();
        return getMcpRequestProps();
      }),
    ]);

    expect(first).toEqual({ userId: "first", scopes: ["projects:read"] });
    expect(second).toEqual({ userId: "second", scopes: ["content:read"] });
    expect(getMcpRequestProps()).toBeUndefined();
  });
});
