import { describe, expect, it } from "vitest";
import {
  buildFreshReadsSql,
  formatFreshReads,
  type FreshRead,
} from "~/lib/motherduck.server";

describe("buildFreshReadsSql", () => {
  it("defaults to interesting news, opinion, and tutorials, newest first", () => {
    const sql = buildFreshReadsSql({});
    expect(sql).toContain("TRY_CAST(interestingness_score AS INT) >= 3");
    expect(sql).toContain("regexp_matches(content_type, 'news|opinion|tutorial')");
    expect(sql).toContain("ORDER BY TRY_CAST(post_date AS TIMESTAMP) DESC");
    expect(sql).toContain("LIMIT 8");
  });

  it("filters by a single known content type, ignores unknown ones", () => {
    expect(buildFreshReadsSql({ contentType: "tutorial" })).toContain(
      "content_type LIKE '%tutorial%'",
    );
    expect(buildFreshReadsSql({ contentType: "drop table" })).toContain(
      "regexp_matches",
    );
  });

  it("escapes quotes in the topic and clamps the limit", () => {
    const sql = buildFreshReadsSql({ topic: "duck's; DROP--", limit: 999 });
    expect(sql).toContain("title ILIKE '%duck''s; DROP--%'");
    expect(sql).toContain("LIMIT 20");
    expect(buildFreshReadsSql({ limit: -5 })).toContain("LIMIT 1");
  });
});

describe("formatFreshReads", () => {
  const read: FreshRead = {
    title: "Open Source AI Gap Map",
    url: "https://example.com/gap-map",
    feed: "Simon Willison's Weblog",
    contentType: "news",
    score: "3",
    postDate: "2026-07-03",
    keyInsight: "Structured data mapping the open-source AI ecosystem.",
    summary: "A dataset release.",
  };

  it("renders compact markdown lines", () => {
    const text = formatFreshReads([read]);
    expect(text).toContain("- [Open Source AI Gap Map](https://example.com/gap-map)");
    expect(text).toContain("news, score 3, 2026-07-03, from Simon Willison's Weblog");
    expect(text).toContain("Key insight: Structured data");
  });

  it("suggests loosening the filter when empty", () => {
    expect(formatFreshReads([])).toContain("No matching reads");
  });
});
