import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { mdxPlugin } from "./mdx-plugin";

export default defineConfig({
  plugins: [
    mdxPlugin(),
    cloudflareTest(async () => ({
      main: "./test/mcp/fixture-worker.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        compatibilityDate: "2026-06-08",
        bindings: {
          APP_ORIGIN: "https://vibegarden.test",
          MCP_RESOURCE_URL: "https://vibegarden.test/mcp",
          MCP_ALLOWED_ORIGINS: "https://claude.ai,https://chatgpt.com",
          SUPPORT_EMAIL: "support@example.test",
          SESSION_SECRET: "worker-test-session-secret",
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "drizzle")),
        },
      },
    })),
  ],
  resolve: { alias: { "~": path.join(import.meta.dirname, "app") } },
  test: {
    include: ["test/mcp/**/*.test.ts"],
    setupFiles: ["./test/mcp/setup.ts"],
  },
});
