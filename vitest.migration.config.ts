import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve("drizzle")),
          TEST_WOTF_BACKFILL_SQL: "",
          TEST_CONTRACT_SQL: "",
        },
      },
    })),
  ],
  test: {
    include: ["test/d1/migration.worker.test.ts"],
    passWithNoTests: true,
  },
});
