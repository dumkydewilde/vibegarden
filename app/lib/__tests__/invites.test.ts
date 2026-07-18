import { afterEach, describe, expect, it, vi } from "vitest";
import { signValue } from "~/lib/auth.server";
import {
  googleAuthRedirect,
  handleGoogleCallback,
} from "~/lib/google.server";
import {
  importBulkInvites,
  parseBulkInviteInput,
  saveBulkInvites,
} from "~/lib/invites.server";

const googleEnv = {
  SESSION_SECRET: "google-invite-unit-test",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
} as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google invite return path", () => {
  it("returns a signed same-origin join path after the callback", async () => {
    const authRequest = new Request(
      "https://vibegarden.test/auth/google?next=%2Fjoin%2Ftoken-123",
    );
    const { url, stateCookie } = await googleAuthRedirect(googleEnv, authRequest);
    const state = new URL(url).searchParams.get("state");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "access-token" })),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              email: "member@example.com",
              email_verified: true,
              name: "Member",
            }),
          ),
        ),
    );

    const result = await handleGoogleCallback(
      googleEnv,
      new Request(
        `https://vibegarden.test/auth/google/callback?code=code&state=${state}`,
        { headers: { Cookie: stateCookie.split(";")[0] } },
      ),
    );

    expect(result).toEqual({
      ok: true,
      email: "member@example.com",
      name: "Member",
      next: "/join/token-123",
    });
  });

  it("treats malformed OAuth cookie encoding as a bad state", async () => {
    const result = await handleGoogleCallback(
      googleEnv,
      new Request(
        "https://vibegarden.test/auth/google/callback?code=code&state=state",
        { headers: { Cookie: "vg_oauth_state=%E0%A4%A" } },
      ),
    );

    expect(result).toEqual({ ok: false, error: "bad-state" });
  });

  it("rejects a signed unsafe return path", async () => {
    const signed = await signValue(
      JSON.stringify({ state: "state", next: "//example.com" }),
      googleEnv.SESSION_SECRET,
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "access-token" })),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ email: "member@example.com", email_verified: true }),
          ),
        ),
    );

    const result = await handleGoogleCallback(
      googleEnv,
      new Request(
        "https://vibegarden.test/auth/google/callback?code=code&state=state",
        { headers: { Cookie: `vg_oauth_state=${encodeURIComponent(signed)}` } },
      ),
    );

    expect(result).toMatchObject({ ok: true, next: "/" });
  });
});

describe("parseBulkInviteInput", () => {
  it("parses supported separators and an optional CSV header", () => {
    const result = parseBulkInviteInput([
      'email\n "Alice@Example.com"\nbob@example.com; carol@example.com',
    ]);

    expect(result.accepted).toEqual([
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);
    expect(result.duplicates).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("deduplicates normalized addresses and reports invalid values", () => {
    const result = parseBulkInviteInput([
      "Alice@example.com, alice@EXAMPLE.com, not-an-email, ,bob@example.com",
    ]);

    expect(result.accepted).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
    expect(result.duplicates).toEqual(["alice@example.com"]);
    expect(result.rejected).toEqual([
      { value: "not-an-email", reason: "Invalid email address" },
    ]);
  });

  it("combines pasted and uploaded input", () => {
    const result = parseBulkInviteInput([
      "alice@example.com",
      "email\nbob@example.com\nalice@example.com",
    ]);

    expect(result.accepted).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
    expect(result.duplicates).toEqual(["alice@example.com"]);
  });
});

describe("saveBulkInvites", () => {
  it("writes every accepted address in one D1 batch", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const batch = vi.fn(async () => []);
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            const statement = { sql, bindings };
            statements.push(statement);
            return statement;
          },
        };
      },
      batch,
    } as unknown as D1Database;

    await saveBulkInvites(
      db,
      ["alice@example.com", "bob@example.com"],
      "admin@example.com",
      1234,
    );

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(statements);
    expect(statements).toHaveLength(2);
    expect(statements[0].bindings).toEqual([
      "alice@example.com",
      "admin@example.com",
      1234,
    ]);
    expect(statements[0].sql).toContain("WHEN invites.status = 'joined'");
  });

  it("does not call D1 when there are no accepted addresses", async () => {
    const batch = vi.fn(async () => []);
    const db = { batch } as unknown as D1Database;

    await saveBulkInvites(db, [], "admin@example.com", 1234);

    expect(batch).not.toHaveBeenCalled();
  });
});

describe("importBulkInvites", () => {
  it("combines textarea and file input before saving", async () => {
    const batch = vi.fn(async () => []);
    const db = {
      prepare(sql: string) {
        return { bind: (...bindings: unknown[]) => ({ sql, bindings }) };
      },
      batch,
    } as unknown as D1Database;
    const form = new FormData();
    form.set("emails", "Alice@example.com");
    form.set(
      "inviteFile",
      new File(["email\nbob@example.com\nalice@example.com"], "invites.csv", {
        type: "text/csv",
      }),
    );

    const result = await importBulkInvites(db, form, "admin@example.com", 1234);

    expect(result.imported).toBe(2);
    expect(result.duplicates).toEqual(["alice@example.com"]);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("skips D1 when every submitted value is invalid", async () => {
    const batch = vi.fn(async () => []);
    const db = { batch } as unknown as D1Database;
    const form = new FormData();
    form.set("emails", "not-an-email");

    const result = await importBulkInvites(db, form, "admin@example.com", 1234);

    expect(result.imported).toBe(0);
    expect(result.rejected).toEqual([
      { value: "not-an-email", reason: "Invalid email address" },
    ]);
    expect(batch).not.toHaveBeenCalled();
  });
});
