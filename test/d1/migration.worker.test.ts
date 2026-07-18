import { applyD1Migrations, env } from "cloudflare:test";
import { expect, test } from "vitest";

async function seedLegacyDatabase(db: D1Database) {
  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id, email, name, role, stage, model_pref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "user_owner",
        "dumky@motherduck.com",
        "Bootstrap Owner",
        "admin",
        "exploring",
        "claude",
        1,
      ),
    db
      .prepare(
        "INSERT INTO users (id, email, name, role, stage, model_pref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "user_member",
        "member@example.com",
        "Member",
        "user",
        "questionnaire",
        "chatgpt",
        2,
      ),
    db
      .prepare(
        "INSERT INTO invites (email, invited_by, status, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind("invitee@example.com", "dumky@motherduck.com", "pending", 3),
    db
      .prepare(
        "INSERT INTO chat_threads (id, user_id, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("thread_1", "user_member", "Legacy thread", null, 4, 4),
    db
      .prepare(
        "INSERT INTO projects (id, user_id, title, one_liner, modules, status, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "project_1",
        "user_member",
        "Legacy project",
        null,
        null,
        "seed",
        "thread_1",
        5,
        5,
      ),
    db
      .prepare(
        "INSERT INTO questionnaire_responses (user_id, answers, created_at) VALUES (?, ?, ?)",
      )
      .bind("user_member", "{}", 6),
    db
      .prepare(
        "INSERT INTO comments (id, target_type, target_id, user_id, parent_id, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "comment_1",
        "article",
        "legacy-article",
        "user_member",
        null,
        "Legacy comment",
        "visible",
        7,
        7,
      ),
    db
      .prepare(
        "INSERT INTO site_feedback (id, user_id, page, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("feedback_1", "user_member", "/", "Legacy feedback", "new", 8),
  ]);
}

test("expands and backfills a populated single-club database", async () => {
  const expandName = "0006_multi_club_expand.sql";
  const baseline = env.TEST_MIGRATIONS.filter(
    (migration) => migration.name < expandName,
  );
  const expand = env.TEST_MIGRATIONS.find(
    (migration) => migration.name === expandName,
  );
  expect(expand).toBeDefined();

  await applyD1Migrations(env.DB, baseline);
  await seedLegacyDatabase(env.DB);
  await applyD1Migrations(env.DB, [expand!]);
  await env.DB.exec(env.TEST_WOTF_BACKFILL_SQL);

  const owner = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM club_memberships WHERE club_id = 'club_wotf' AND role = 'owner'",
  ).first<{ count: number }>();
  expect(owner?.count).toBe(1);

  for (const table of [
    "projects",
    "chat_threads",
    "questionnaire_responses",
    "comments",
    "site_feedback",
    "club_invitations",
  ]) {
    const result = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE club_id IS NULL`,
    ).first<{ count: number }>();
    expect(result?.count).toBe(0);
  }

  const beforeSecondBackfill = await Promise.all(
    [
      "clubs",
      "club_memberships",
      "club_invitations",
      "club_ai_credentials",
    ].map(async (table) =>
      env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
        count: number;
      }>(),
    ),
  );
  await env.DB.exec(env.TEST_WOTF_BACKFILL_SQL);
  const afterSecondBackfill = await Promise.all(
    [
      "clubs",
      "club_memberships",
      "club_invitations",
      "club_ai_credentials",
    ].map(async (table) =>
      env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
        count: number;
      }>(),
    ),
  );
  expect(afterSecondBackfill.map((result) => result?.count)).toEqual(
    beforeSecondBackfill.map((result) => result?.count),
  );

  await env.DB.exec(env.TEST_CONTRACT_SQL);

  for (const column of ["role", "stage", "model_pref"]) {
    const columns = await env.DB.prepare("PRAGMA table_info(users)").all<{
      name: string;
    }>();
    expect(columns.results.map((result) => result.name)).not.toContain(column);
  }
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all<{ name: string }>();
  expect(tables.results.map((table) => table.name)).not.toContain("invites");

  for (const table of [
    "projects",
    "chat_threads",
    "questionnaire_responses",
    "comments",
    "site_feedback",
    "club_invitations",
  ]) {
    const result = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE club_id IS NULL`,
    ).first<{ count: number }>();
    expect(result?.count).toBe(0);
  }

  for (const table of [
    "projects",
    "chat_threads",
    "questionnaire_responses",
    "comments",
    "site_feedback",
    "club_invitations",
  ]) {
    const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{
      name: string;
      notnull: number;
    }>();
    expect(
      columns.results.find((column) => column.name === "club_id")?.notnull,
    ).toBe(1);
  }
});

test("fails the slug-claim migration when a canonical slug conflicts with an alias", async () => {
  await env.DB.exec(
    "CREATE TABLE slug_claim_backfill_test (slug text PRIMARY KEY NOT NULL, club_id text NOT NULL, created_at integer NOT NULL)",
  );
  await env.DB.prepare(
    "INSERT INTO slug_claim_backfill_test (slug, club_id, created_at) VALUES (?, ?, ?)",
  ).bind("canonical-collision", "canonical-club", 10).run();

  await expect(
    env.DB.prepare(
      "INSERT INTO slug_claim_backfill_test (slug, club_id, created_at) VALUES (?, ?, ?)",
    ).bind("canonical-collision", "alias-club", 11).run(),
  ).rejects.toThrow();
});

test("keeps slug claims consistent for direct canonical and alias writes", async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare(
    "INSERT INTO clubs (id, name, slug, model_policy, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind("direct-first", "Direct first", "direct-first", "free_only", "active", 20, 20).run();
  await env.DB.prepare(
    "INSERT INTO clubs (id, name, slug, model_policy, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind("direct-second", "Direct second", "direct-second", "free_only", "active", 21, 21).run();

  expect(
    await env.DB.prepare("SELECT club_id FROM club_slug_claims WHERE slug = ?")
      .bind("direct-first")
      .first(),
  ).toEqual({ club_id: "direct-first" });
  await expect(
    env.DB.prepare(
      "INSERT INTO club_slug_aliases (slug, club_id, created_at) VALUES (?, ?, ?)",
    ).bind("direct-first", "direct-second", 22).run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare("UPDATE clubs SET slug = ? WHERE id = ?")
      .bind("direct-first", "direct-second")
      .run(),
  ).rejects.toThrow();
});
