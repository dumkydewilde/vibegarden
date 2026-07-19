import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { mdxPlugin } from "./mdx-plugin";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve("app"),
    },
  },
  plugins: [
    mdxPlugin(),
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve("drizzle")),
        },
      },
    })),
  ],
  test: {
    include: ["test/d1/**/*.worker.test.ts"],
    exclude: ["test/d1/migration.worker.test.ts"],
    setupFiles: ["./test/d1/apply-migrations.ts"],
  },
});
