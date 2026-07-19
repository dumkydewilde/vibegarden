import { describe, expect, it } from "vitest";
import { safeInternalPath } from "~/lib/return-path";

describe("safeInternalPath", () => {
  const request = new Request("https://vibegarden.test/login");

  it.each([
    ["/authorize?client_id=abc&state=xyz", "/authorize?client_id=abc&state=xyz"],
    ["https://vibegarden.test/authorize?state=xyz", "/authorize?state=xyz"],
    ["//evil.example/steal", "/"],
    ["https://evil.example/steal", "/"],
    ["javascript:alert(1)", "/"],
  ])("maps %s to %s", (candidate, expected) => {
    expect(safeInternalPath(request, candidate)).toBe(expected);
  });
});
