import { describe, expect, it, vi } from "vitest";

const getDb = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db.server", () => ({ getDb }));
vi.mock("~/lib/mailer.server", () => ({ sendOtpEmail: vi.fn() }));

import { upsertUser } from "~/lib/otp.server";

describe("reviewer user upsert", () => {
  it("refuses a conflicting reviewer email without mutating the participant", async () => {
    const existing = {
      id: "legacy-reviewer-id",
      email: "review@example.test",
      name: "Reviewer",
      role: "admin" as const,
      platformRole: "super_admin" as const,
      stage: "invited" as const,
      modelPref: null,
      createdAt: 1,
    };
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    getDb.mockReturnValue({
      query: { users: { findFirst: vi.fn().mockResolvedValue(existing) } },
      update,
    });

    const user = await upsertUser(
      {} as Env,
      existing.email,
      "user",
      "476a9495-bcec-58a9-a9cf-10eb4d580e4a",
    );

    expect(user).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps a deterministic reviewer idempotent", async () => {
    const existing = {
      id: "476a9495-bcec-58a9-a9cf-10eb4d580e4a",
      email: "review@example.test",
      name: "MCP reviewer",
      role: "user" as const,
      platformRole: "user" as const,
      stage: "exploring" as const,
      modelPref: null,
      createdAt: 1,
    };
    const update = vi.fn();
    getDb.mockReturnValue({
      query: { users: { findFirst: vi.fn().mockResolvedValue(existing) } },
      update,
    });

    await expect(upsertUser(
      {} as Env,
      existing.email,
      "user",
      existing.id,
    )).resolves.toEqual(existing);
    expect(update).not.toHaveBeenCalled();
  });
});
