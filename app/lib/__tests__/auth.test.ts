import { afterEach, describe, expect, it, vi } from "vitest";
import { signValue, verifyValue } from "~/lib/auth.server";
import {
  googleAuthRedirect,
  handleGoogleCallback,
} from "~/lib/google.server";
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

  it("explains a missing secret instead of a cryptic crypto error", async () => {
    await expect(signValue("session-id-123", "")).rejects.toThrow(
      /SESSION_SECRET is not set/,
    );
    await expect(
      verifyValue(`value.${"ab".repeat(32)}`, ""),
    ).rejects.toThrow(/SESSION_SECRET is not set/);
  });
});

describe("Google OAuth login state", () => {
  const env = {
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    SESSION_SECRET: "test-secret",
  } as Env;

  afterEach(() => vi.unstubAllGlobals());

  async function callbackFor(next: string) {
    const redirectRequest = new Request(
      `https://vibegarden.test/auth/google?next=${encodeURIComponent(next)}`,
    );
    const { url, stateCookie } = await googleAuthRedirect(env, redirectRequest);
    const nonce = new URL(url).searchParams.get("state");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "token" }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              email: "ada@example.com",
              email_verified: true,
              name: "Ada",
            }),
            { status: 200 },
          ),
        ),
    );

    return handleGoogleCallback(
      env,
      new Request(
        `https://vibegarden.test/auth/google/callback?code=code&state=${nonce}`,
        { headers: { Cookie: stateCookie } },
      ),
    );
  }

  it("preserves a safe internal return path in its signed state cookie", async () => {
    const response = await callbackFor("/authorize?client_id=abc");

    expect(response).toEqual({
      ok: true,
      email: "ada@example.com",
      name: "Ada",
      next: "/authorize?client_id=abc",
    });
  });

  it.each(["//evil.example/steal", "https://evil.example/steal"])(
    "rejects an unsafe return path %s",
    async (next) => {
      const response = await callbackFor(next);

      expect(response).toMatchObject({ ok: true, next: "/" });
    },
  );
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
