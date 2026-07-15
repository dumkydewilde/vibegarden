import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const files = [
  "app/routes/learning.$slug.tsx",
  "app/routes/garden.modules.$slug.tsx",
];

describe("article page layout", () => {
  it("uses the shared wider centered container on every long-form route", async () => {
    const [css, ...routes] = await Promise.all([
      readFile("app/app.css", "utf8"),
      ...files.map((file) => readFile(file, "utf8")),
    ]);

    expect(css).toMatch(/\.article-page\s*\{[\s\S]*max-width:\s*78ch/);
    expect(css).toMatch(/\.article-page\s*\{[\s\S]*margin-inline:\s*auto/);
    for (const route of routes) {
      expect(route).toContain('className="article-page"');
    }
  });
});
