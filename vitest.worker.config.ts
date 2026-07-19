import { readD1Migrations, cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./test/worker/fixture-worker.ts",
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        d1Databases: {
          UPGRADE_DB: "artifact-upgrade-regression",
        },
        bindings: {
          APP_ORIGIN: "http://localhost:5173",
          RENDERER_ORIGIN: "http://localhost:8787",
          WEB_ALLOWED_ORIGINS: "http://localhost:5173",
          SESSION_SECRET: "test-session-secret",
          RENDERER_SIGNING_SECRET: "test-renderer-signing-secret",
          TEST_MIGRATIONS: await readD1Migrations("./drizzle"),
        },
      },
    })),
  ],
  test: {
    include: ["test/worker/**/*.test.ts"],
    setupFiles: ["./test/worker/setup.ts"],
  },
});
