import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

test("applies D1 migrations and exposes the configured Worker bindings", async () => {
  const migration = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'",
  ).first<{ name: string }>();

  expect(migration).toEqual({ name: "users" });

  await env.OAUTH_KV.put("task-1-smoke", "available");
  expect(await env.OAUTH_KV.get("task-1-smoke")).toBe("available");
  await env.OAUTH_KV.delete("task-1-smoke");

  await expect(env.MCP_GENERAL_LIMITER.limit({ key: "task-1-smoke" })).resolves.toEqual({
    success: true,
  });
  await expect(env.MCP_HISTORY_LIMITER.limit({ key: "task-1-smoke" })).resolves.toEqual({
    success: true,
  });
});
