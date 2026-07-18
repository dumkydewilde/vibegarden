import { describe, expect, it } from "vitest";
import {
  assertReviewerIdentity,
  buildReviewerPreflightSql,
  buildReviewerSeedSql,
  reviewerId,
} from "../../../scripts/seed-mcp-reviewer.mjs";

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

  it("aborts the deterministic seed before writes when the email belongs to another user", () => {
    const email = "review@example.test";
    expect(buildReviewerPreflightSql(email)).toMatchInlineSnapshot(`"SELECT id FROM users WHERE email = 'review@example.test' LIMIT 1;"`);
    expect(() => assertReviewerIdentity(email, JSON.stringify([
      { results: [{ id: "participant-id" }], success: true },
    ]))).toThrow("already belongs to a different user");
  });

  it("allows an existing deterministic reviewer identity", () => {
    const email = "review@example.test";
    expect(assertReviewerIdentity(email, JSON.stringify([
      { results: [{ id: reviewerId(email, "user") }], success: true },
    ]))).toBe(reviewerId(email, "user"));
  });

  it("fails closed for valid JSON that is not a recognized Wrangler result shape", () => {
    const email = "review@example.test";
    for (const output of [
      JSON.stringify({ results: [] }),
      JSON.stringify([{ success: false, results: [] }]),
      JSON.stringify([{ success: true, result: [] }]),
    ]) {
      expect(() => assertReviewerIdentity(email, output))
        .toThrow("Could not verify the existing reviewer identity");
    }
  });
});
