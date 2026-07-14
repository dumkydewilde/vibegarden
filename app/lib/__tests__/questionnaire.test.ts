import { describe, expect, it } from "vitest";
import { parseAnswers, summarizeAnswers } from "~/lib/questionnaire";

describe("parseAnswers", () => {
  it("accepts a complete set of answers", () => {
    const answers = parseAnswers({
      subscription: "none",
      budget: "5",
      devices: ["laptop", "phone"],
      expectations: "A recipe scanner",
    });
    expect(answers).toEqual({
      subscription: "none",
      budget: 5,
      devices: ["laptop", "phone"],
      expectations: "A recipe scanner",
    });
  });

  it("nulls the budget when they already have a subscription", () => {
    const answers = parseAnswers({
      subscription: "chatgpt",
      budget: "20",
      devices: ["laptop"],
    });
    expect(answers?.budget).toBeNull();
  });

  it("rejects missing subscription or devices", () => {
    expect(
      parseAnswers({ subscription: "nope", devices: ["laptop"] }),
    ).toBeNull();
    expect(parseAnswers({ subscription: "claude", devices: [] })).toBeNull();
    expect(
      parseAnswers({ subscription: "claude", devices: ["smartwatch"] }),
    ).toBeNull();
  });

  it("summarizes for the admin view", () => {
    const summary = summarizeAnswers({
      subscription: "none",
      budget: 5,
      devices: ["laptop", "phone"],
      expectations: "A recipe scanner",
    });
    expect(summary).toContain("no subscription yet");
    expect(summary).toContain("€5/mo");
    expect(summary).toContain("laptop + phone");
    expect(summary).toContain("recipe scanner");
  });
});
