import { describe, expect, it } from "vitest";
import * as clubPaths from "~/lib/club-path";

describe("clubPath", () => {
  it("builds a club root path", () => {
    expect(clubPaths.clubPath("wotf")).toBe("/clubs/wotf");
    expect(clubPaths.clubPath("wotf", "/")).toBe("/clubs/wotf");
  });

  it("normalizes a nested path and encodes the slug", () => {
    expect(clubPaths.clubPath("AC Milan", "/garden/projects")).toBe(
      "/clubs/AC%20Milan/garden/projects",
    );
  });

  it("maps legacy workspace paths to WOTF without dropping the URL suffix", () => {
    const legacyClubPath = (
      clubPaths as { legacyClubPath?: (url: string, section: string, rest?: string) => string | null }
    ).legacyClubPath;

    expect(legacyClubPath).toBeTypeOf("function");
    expect(
      legacyClubPath!(
        "https://example.com/garden/projects/p-1?view=all#notes",
        "garden",
        "projects/p-1",
      ),
    ).toBe("/clubs/wotf/garden/projects/p-1?view=all#notes");
    expect(legacyClubPath!("https://example.com/login", "login")).toBeNull();
  });
});
