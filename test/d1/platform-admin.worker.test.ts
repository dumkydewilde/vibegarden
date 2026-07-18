import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { User } from "~/db/schema";
import {
  listPlatformClubs,
  setClubModelPolicy,
  setClubSpendingLimit,
} from "~/lib/clubs.server";
import { restoreClub } from "~/lib/memberships.server";

const testEnv = { DB: env.DB } as Env;

async function user(
  id: string,
  platformRole: "user" | "super_admin" = "user",
) {
  const now = Date.now();
  await env.DB
    .prepare(
      "INSERT INTO users (id, email, platform_role, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id, `${id}@example.com`, platformRole, now)
    .run();
  return {
    id,
    email: `${id}@example.com`,
    name: null,
    role: "user",
    stage: "invited",
    modelPref: null,
    platformRole,
    themePref: null,
    lastClubId: null,
    createdAt: now,
  } as User;
}

async function club(
  id: string,
  status: "active" | "archived" = "active",
) {
  const now = Date.now();
  await env.DB
    .prepare(
      "INSERT INTO clubs (id, name, slug, model_policy, status, spending_limit_usd, created_at, updated_at) VALUES (?, ?, ?, 'free_only', ?, ?, ?, ?)",
    )
    .bind(id, `${id} club`, id, status, 25, now, now)
    .run();
  await env.DB
    .prepare(
      "INSERT INTO club_ai_credentials (club_id, provisioning_state, synced_policy) VALUES (?, 'ready', 'free_only')",
    )
    .bind(id)
    .run();
}

async function member(clubId: string, userId: string, role: "owner" | "admin" | "member") {
  const now = Date.now();
  await env.DB
    .prepare(
      "INSERT INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(clubId, userId, role, now, now)
    .run();
}

async function response(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected a permission response");
}

describe("platform club administration", () => {
  it("lists grouped club summaries with only explicit members and detects policy drift", async () => {
    const owner = await user("platform-summary-owner");
    const memberUser = await user("platform-summary-member");
    const superAdmin = await user("platform-summary-super", "super_admin");
    await club("platform-summary");
    await member("platform-summary", owner.id, "owner");
    await member("platform-summary", memberUser.id, "member");

    const summaries = await listPlatformClubs(testEnv);
    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "platform-summary",
          owner: {
            id: owner.id,
            email: owner.email,
            name: null,
          },
          memberCount: 2,
          status: "active",
          modelPolicy: "free_only",
          spendingLimitUsd: 25,
          credentialState: "ready",
          syncedPolicy: "free_only",
          hasSyncDrift: false,
        }),
      ]),
    );

    // Platform authority is implicit and must never inflate membership counts.
    expect(summaries.find((summary) => summary.id === "platform-summary")?.memberCount).toBe(2);
    expect(superAdmin.id).not.toBe(owner.id);

    await env.DB
      .prepare("UPDATE clubs SET model_policy = 'all_models' WHERE id = ?")
      .bind("platform-summary")
      .run();
    expect(
      (await listPlatformClubs(testEnv)).find(
        (summary) => summary.id === "platform-summary",
      ),
    ).toMatchObject({ hasSyncDrift: true, syncedPolicy: "free_only" });
  });

  it("allows only super admins to change funded policy and spending, pending sync with non-secret audits", async () => {
    const normalUser = await user("platform-mutation-user");
    const superAdmin = await user("platform-mutation-super", "super_admin");
    await club("platform-mutation");

    expect((await response(() => setClubModelPolicy(testEnv, normalUser, "platform-mutation", "all_models"))).status).toBe(404);
    expect((await response(() => setClubSpendingLimit(testEnv, normalUser, "platform-mutation", 75))).status).toBe(404);

    await setClubModelPolicy(testEnv, superAdmin, "platform-mutation", "all_models");
    await setClubSpendingLimit(testEnv, superAdmin, "platform-mutation", 75);

    expect(
      await env.DB
        .prepare(
          "SELECT model_policy AS modelPolicy, spending_limit_usd AS spendingLimitUsd FROM clubs WHERE id = ?",
        )
        .bind("platform-mutation")
        .first(),
    ).toEqual({ modelPolicy: "all_models", spendingLimitUsd: 75 });
    expect(
      await env.DB
        .prepare("SELECT provisioning_state AS state, synced_policy AS syncedPolicy FROM club_ai_credentials WHERE club_id = ?")
        .bind("platform-mutation")
        .first(),
    ).toEqual({ state: "pending", syncedPolicy: null });
    const audits = await env.DB
      .prepare("SELECT action, metadata FROM audit_events WHERE club_id = ? ORDER BY created_at")
      .bind("platform-mutation")
      .all<{ action: string; metadata: string | null }>();
    expect(audits.results.map((event) => event.action)).toEqual([
      "club.model_policy_changed",
      "club.spending_limit_changed",
    ]);
    expect(JSON.stringify(audits.results)).not.toMatch(/key|cipher|secret|token/i);
  });

  it("restores archived clubs only for a super admin and records the platform lifecycle audit", async () => {
    const normalUser = await user("platform-restore-user");
    const superAdmin = await user("platform-restore-super", "super_admin");
    await club("platform-restore", "archived");

    expect((await response(() => restoreClub(testEnv, normalUser, "platform-restore"))).status).toBe(404);
    await restoreClub(testEnv, superAdmin, "platform-restore");

    expect(
      await env.DB.prepare("SELECT status FROM clubs WHERE id = ?").bind("platform-restore").first(),
    ).toEqual({ status: "active" });
    expect(
      await env.DB
        .prepare("SELECT action, metadata FROM audit_events WHERE club_id = ?")
        .bind("platform-restore")
        .first(),
    ).toEqual({ action: "club.restored", metadata: null });
  });
});
