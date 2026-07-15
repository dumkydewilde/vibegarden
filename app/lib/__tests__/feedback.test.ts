import { describe, expect, it } from "vitest";
import {
  FEEDBACK_MAX,
  isFeedbackStatus,
  normalizeFeedbackBody,
} from "~/lib/feedback";

describe("normalizeFeedbackBody", () => {
  it("trims and keeps content", () => {
    expect(normalizeFeedbackBody("  the login is confusing ")).toBe(
      "the login is confusing",
    );
  });

  it("returns null when there is nothing to send", () => {
    expect(normalizeFeedbackBody("   ")).toBeNull();
  });

  it("caps at FEEDBACK_MAX characters", () => {
    expect(normalizeFeedbackBody("x".repeat(FEEDBACK_MAX + 10))).toHaveLength(
      FEEDBACK_MAX,
    );
  });
});

describe("isFeedbackStatus", () => {
  it("accepts the three known statuses", () => {
    expect(isFeedbackStatus("new")).toBe(true);
    expect(isFeedbackStatus("read")).toBe(true);
    expect(isFeedbackStatus("resolved")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isFeedbackStatus("done")).toBe(false);
    expect(isFeedbackStatus(undefined)).toBe(false);
  });
});
