import { describe, expect, it } from "vitest";
import { mcpServerUrl } from "../public-url";

describe("mcpServerUrl", () => {
  it("uses the configured app origin", () => {
    expect(mcpServerUrl("https://mcp-staging.vibegarden.club")).toBe(
      "https://mcp-staging.vibegarden.club/mcp",
    );
  });

  it("falls back to the public origin when the origin is missing or unusable", () => {
    expect(mcpServerUrl(undefined)).toBe("https://vibegarden.club/mcp");
    expect(mcpServerUrl("")).toBe("https://vibegarden.club/mcp");
    expect(mcpServerUrl("not a url")).toBe("https://vibegarden.club/mcp");
  });
});
