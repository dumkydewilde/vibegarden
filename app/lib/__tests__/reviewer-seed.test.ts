import { describe, expect, it } from "vitest";
import { buildReviewerSeedSql } from "../../../scripts/seed-mcp-reviewer.mjs";

describe("MCP reviewer seeder", () => {
  it("is deterministic and only updates deterministic reviewer rows", () => {
    const first = buildReviewerSeedSql("Review@Example.Test");
    const second = buildReviewerSeedSql("review@example.test");

    expect(first).toBe(second);
    expect(first).toContain("476a9495-bcec-58a9-a9cf-10eb4d580e4a");
    expect(first).not.toMatch(/\bDELETE\b/i);
    expect(first).not.toMatch(/ON CONFLICT\(email\) DO UPDATE/i);
    expect(first).toContain("ON CONFLICT(id) DO UPDATE");
  });
});
