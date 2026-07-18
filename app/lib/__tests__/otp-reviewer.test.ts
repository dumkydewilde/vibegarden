import { describe, expect, it, vi } from "vitest";

const getDb = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db.server", () => ({ getDb }));
vi.mock("~/lib/mailer.server", () => ({ sendOtpEmail: vi.fn() }));

import { upsertUser } from "~/lib/otp.server";

describe("reviewer user upsert", () => {
  it("demotes an existing admin reviewer without replacing its identity", async () => {
    const existing = {
      id: "legacy-reviewer-id",
      email: "review@example.test",
      name: "Reviewer",
      role: "admin" as const,
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

    expect(user).toMatchObject({ id: "legacy-reviewer-id", role: "user" });
    expect(set).toHaveBeenCalledWith({ role: "user" });
  });
});
