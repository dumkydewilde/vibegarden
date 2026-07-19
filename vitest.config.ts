import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { mdxPlugin } from "./mdx-plugin";

export default defineConfig({
  plugins: [mdxPlugin()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "app/**/__tests__/**/*.test.{ts,tsx}",
      "packages/**/__tests__/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
});
