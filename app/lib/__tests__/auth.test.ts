import { describe, expect, it } from "vitest";
import { signValue, verifyValue } from "~/lib/auth.server";
import {
  codesMatch,
  generateCode,
  isValidEmail,
  normalizeEmail,
} from "~/lib/otp.server";

describe("session cookie signing", () => {
  const secret = "test-secret";

  it("round-trips a signed value", async () => {
    const signed = await signValue("session-id-123", secret);
    expect(await verifyValue(signed, secret)).toBe("session-id-123");
  });

  it("rejects a tampered value", async () => {
    const signed = await signValue("session-id-123", secret);
    const tampered = signed.replace("session-id-123", "session-id-999");
    expect(await verifyValue(tampered, secret)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const signed = await signValue("session-id-123", secret);
    expect(await verifyValue(signed, "other-secret")).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyValue("no-dot-here", secret)).toBeNull();
    expect(await verifyValue("value.deadbeef", secret)).toBeNull();
  });
});

describe("otp helpers", () => {
  it("generates 6-digit codes", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });

  it("compares codes safely", () => {
    expect(codesMatch("123456", "123456")).toBe(true);
    expect(codesMatch("123456", "123457")).toBe(false);
    expect(codesMatch("123456", "12345")).toBe(false);
  });

  it("normalizes and validates email", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(isValidEmail("foo@bar.com")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});
