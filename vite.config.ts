import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { mdxPlugin } from "./mdx-plugin";

export default defineConfig({
  // DuckDB is imported only when a person first attaches data. Optimizing it
  // on startup avoids Vite's one-time dependency-reload and preserves the
  // current conversation and selected file.
  optimizeDeps: {
    include: ["@duckdb/duckdb-wasm"],
  },
  plugins: [
    mdxPlugin(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
