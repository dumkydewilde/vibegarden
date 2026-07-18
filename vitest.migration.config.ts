import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve("app"),
    },
  },
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve("drizzle")),
          TEST_WOTF_BACKFILL_SQL: (
            await readFile(path.resolve("scripts/backfill-wotf.sql"), "utf8")
          ).replaceAll("\n", " "),
          TEST_WOTF_VERIFY_SQL: (
            await readFile(
              path.resolve("scripts/verify-multi-club-migration.sql"),
              "utf8",
            )
          ).replaceAll("\n", " "),
          TEST_CONTRACT_SQL: (
            await readFile(
              path.resolve("scripts/contract-multi-club.sql"),
              "utf8",
            )
          ).replaceAll("\n", " "),
          TEST_CONTRACT_VERIFY_SQL: (
            await readFile(
              path.resolve("scripts/verify-multi-club-contract.sql"),
              "utf8",
            )
          ).replaceAll("\n", " "),
        },
      },
    })),
  ],
  test: {
    include: ["test/d1/migration.worker.test.ts"],
    passWithNoTests: true,
  },
});
