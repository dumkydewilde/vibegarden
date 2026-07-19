import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const now = 1_784_200_000_000;

describe("artifact migration upgrades", () => {
  it("upgrades populated 0000-0007 data through 0008 while preserving artifact foreign keys", async () => {
    await applyD1Migrations(env.UPGRADE_DB, env.TEST_MIGRATIONS.slice(0, 8));
    await env.UPGRADE_DB.batch([
      env.UPGRADE_DB.prepare("INSERT INTO users (id, email, created_at) VALUES ('upgrade-user', 'upgrade@example.test', ?)").bind(now),
      env.UPGRADE_DB.prepare("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES ('upgrade-project', 'upgrade-user', 'Upgrade project', 'seed', ?, ?)").bind(now, now),
      env.UPGRADE_DB.prepare("INSERT INTO artifacts (id, user_id, project_id, type, title, visibility, created_at, updated_at) VALUES ('upgrade-artifact', 'upgrade-user', 'upgrade-project', 'html', 'Upgrade artifact', 'private', ?, ?)").bind(now, now),
      env.UPGRADE_DB.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, source, allowed_data_origins, file_count, total_bytes, created_by, created_at) VALUES ('upgrade-version', 'upgrade-artifact', 1, 'web', '[]', 1, 1, 'upgrade-user', ?)").bind(now),
      env.UPGRADE_DB.prepare("INSERT INTO artifact_files (version_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES ('upgrade-version', 'index.html', 'artifacts/upgrade/index.html', 'text/html', 1, ?, ?)").bind("a".repeat(64), now),
      env.UPGRADE_DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES ('upgrade-upload', 'upgrade-user', 'pending-artifact', 'pending-version', 'upgrade-project', 'html', 'Pending artifact', '[]', 'web', 'pending', 'upgrade-key', ?, ?, ?)").bind(now + 1, now, now),
      env.UPGRADE_DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES ('upgrade-upload', 'index.html', 'artifacts/pending/index.html', 'text/html', 1, ?, ?)").bind("b".repeat(64), now),
    ]);

    await applyD1Migrations(env.UPGRADE_DB, env.TEST_MIGRATIONS.slice(8));

    await expect(env.UPGRADE_DB.prepare("SELECT id, status FROM artifact_uploads WHERE id = 'upgrade-upload'").first()).resolves.toEqual({ id: "upgrade-upload", status: "pending" });
    await expect(env.UPGRADE_DB.prepare("SELECT r2_key FROM artifact_upload_files WHERE upload_id = 'upgrade-upload'").first()).resolves.toEqual({ r2_key: "artifacts/pending/index.html" });
    await expect(env.UPGRADE_DB.prepare("SELECT r2_key FROM artifact_files WHERE version_id = 'upgrade-version'").first()).resolves.toEqual({ r2_key: "artifacts/upgrade/index.html" });
    const uploadForeignKeys = await env.UPGRADE_DB.prepare("PRAGMA foreign_key_list(artifact_uploads)").all<{ from: string; table: string }>();
    expect(uploadForeignKeys.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "user_id", table: "users" }),
      expect.objectContaining({ from: "project_id", table: "projects" }),
    ]));
  });
});
