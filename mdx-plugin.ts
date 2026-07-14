import mdx from "@mdx-js/rollup";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import type { Plugin } from "vite";

/**
 * MDX plugin wrapper shared by vite.config.ts and vitest.config.ts.
 * Skips ids with a query (like ?raw) so `import.meta.glob(..., { query: "?raw" })`
 * keeps returning source text instead of a compiled component.
 */
export function mdxPlugin(): Plugin {
  const plugin = mdx({
    remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter, remarkGfm],
  });
  const originalTransform = plugin.transform as (
    this: unknown,
    code: string,
    id: string,
  ) => unknown;

  return {
    ...plugin,
    name: "mdx-no-query",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("?")) return null;
      return originalTransform.call(this, code, id);
    },
  } as Plugin;
}
