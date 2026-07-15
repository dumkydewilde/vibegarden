import { describe, expect, it } from "vitest";
import {
  COMMENT_MAX,
  isCommentTargetType,
  normalizeCommentBody,
  slugify,
} from "~/lib/comment-target";

describe("normalizeCommentBody", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeCommentBody("  hello  ")).toBe("hello");
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(normalizeCommentBody("")).toBeNull();
    expect(normalizeCommentBody("   \n\t ")).toBeNull();
  });

  it("caps at COMMENT_MAX characters", () => {
    const long = "a".repeat(COMMENT_MAX + 50);
    expect(normalizeCommentBody(long)).toHaveLength(COMMENT_MAX);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Open-Meteo weather")).toBe("open-meteo-weather");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Clay would've charged me $40,000")).toBe(
      "clay-would-ve-charged-me-40-000",
    );
  });

  it("has no leading or trailing hyphens", () => {
    expect(slugify("  The Pudding!  ")).toBe("the-pudding");
  });
});

describe("isCommentTargetType", () => {
  it("accepts known types", () => {
    expect(isCommentTargetType("article")).toBe(true);
    expect(isCommentTargetType("inspiration")).toBe(true);
    expect(isCommentTargetType("artifact")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isCommentTargetType("dataset")).toBe(false);
    expect(isCommentTargetType("")).toBe(false);
    expect(isCommentTargetType(null)).toBe(false);
  });
});
