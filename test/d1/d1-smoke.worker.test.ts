import { env } from "cloudflare:test";
import { expect, test } from "vitest";

test("applies the committed D1 schema", async () => {
  const row = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'",
  ).first<{ name: string }>();
  expect(row).toEqual({ name: "users" });
});
