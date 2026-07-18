import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Vite dependency optimization", () => {
  it("pre-optimizes DuckDB before the first data-file attachment", async () => {
    const config = await readFile("vite.config.ts", "utf8");

    expect(config).toMatch(/optimizeDeps:\s*\{\s*include:\s*\[[^\]]*"@duckdb\/duckdb-wasm"/s);
  });
});
