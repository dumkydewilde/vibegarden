import { describe, expect, it } from "vitest";
import { clubPath } from "~/lib/club-path";

describe("clubPath", () => {
  it("builds a club root path", () => {
    expect(clubPath("wotf")).toBe("/clubs/wotf");
    expect(clubPath("wotf", "/")).toBe("/clubs/wotf");
  });

  it("normalizes a nested path and encodes the slug", () => {
    expect(clubPath("AC Milan", "/garden/projects")).toBe(
      "/clubs/AC%20Milan/garden/projects",
    );
  });
});
