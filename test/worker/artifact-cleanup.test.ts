import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanupArtifacts } from "../../app/lib/artifacts/cleanup.server";

const now = Date.UTC(2026, 6, 19, 12, 0, 0);
const recoveryMs = 30 * 24 * 60 * 60 * 1000;

async function resetDatabase() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM artifact_idempotency"),
    env.DB.prepare("DELETE FROM artifact_object_leases"),
    env.DB.prepare("DELETE FROM artifact_upload_files"),
    env.DB.prepare("DELETE FROM artifact_uploads"),
    env.DB.prepare("DELETE FROM artifact_files"),
    env.DB.prepare("DELETE FROM artifact_versions"),
    env.DB.prepare("DELETE FROM artifacts"),
    env.DB.prepare("DELETE FROM projects"),
    env.DB.prepare("DELETE FROM users"),
  ]);
  await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind("cleanup-user", "cleanup@example.test", now).run();
  await env.DB.prepare("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)").bind("cleanup-project", "cleanup-user", "Cleanup project", now, now).run();
}

async function seedUpload(id: string, status: "pending" | "finalizing" | "failed" | "aborted", expiresAt: number) {
  await env.DB.prepare(
    `INSERT INTO artifact_uploads (
      id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins,
      source, status, idempotency_key, expires_at, created_at, updated_at
    ) VALUES (?, 'cleanup-user', ?, ?, 'cleanup-project', 'html', ?, '[]', 'web', ?, ?, ?, ?, ?)`,
  ).bind(id, `artifact-${id}`, `version-${id}`, id, status, `key-${id}`, expiresAt, now, now).run();
}

async function seedArtifact(id: string, deletedAt: number | null) {
  const versionId = `${id}-version`;
  const key = `artifacts/${id}/versions/${versionId}/index.html`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO artifacts (id, user_id, project_id, type, title, visibility, deleted_at, created_at, updated_at) VALUES (?, 'cleanup-user', 'cleanup-project', 'html', ?, 'private', ?, ?, ?)").bind(id, id, deletedAt, now, now),
    env.DB.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, allowed_data_origins, file_count, total_bytes, created_by, created_at) VALUES (?, ?, 1, 'web', 'index.html', '[]', 1, 5, 'cleanup-user', ?)").bind(versionId, id, now),
    env.DB.prepare("INSERT INTO artifact_files (version_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, 'index.html', ?, 'text/html', 5, ?, ?)").bind(versionId, key, "a".repeat(64), now),
  ]);
  await env.ARTIFACTS.put(key, "hello");
  return { key, versionId };
}

beforeEach(resetDatabase);

describe("artifact cleanup", () => {
  it("removes completed upload history with an expired artifact so its project can be deleted", async () => {
    const { key, versionId } = await seedArtifact("project-delete-artifact", now - recoveryMs - 1);
    await env.DB.prepare(
      `INSERT INTO artifact_uploads (
        id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins,
        source, status, idempotency_key, expires_at, created_at, updated_at
      ) VALUES (?, 'cleanup-user', 'project-delete-artifact', ?, 'cleanup-project', 'html', 'Expired artifact', '[]', 'web', 'complete', ?, ?, ?, ?)`,
    ).bind("project-delete-upload", versionId, "project-delete-key", now + 1, now, now).run();

    await cleanupArtifacts(env, now);

    await expect(env.ARTIFACTS.head(key)).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM artifact_uploads WHERE id = 'project-delete-upload'").first()).resolves.toBeNull();
    await expect(env.DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").bind("cleanup-project", "cleanup-user").run()).resolves.toMatchObject({ meta: { changes: 1 } });
    await expect(env.DB.prepare("SELECT id FROM projects WHERE id = 'cleanup-project'").first()).resolves.toBeNull();
  });

  it("purges an expired soft-deleted link artifact with no R2 files", async () => {
    const artifactId = "expired-link-artifact";
    const versionId = "expired-link-version";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifacts (id, user_id, project_id, type, title, visibility, deleted_at, created_at, updated_at) VALUES (?, 'cleanup-user', 'cleanup-project', 'link', 'Expired link', 'private', ?, ?, ?)").bind(artifactId, now - recoveryMs - 1, now, now),
      env.DB.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, source, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at) VALUES (?, ?, 1, 'web', 'https://example.test', '[]', 0, 0, 'cleanup-user', ?)").bind(versionId, artifactId, now),
      env.DB.prepare(`INSERT INTO artifact_uploads (
        id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins,
        source, status, idempotency_key, expires_at, created_at, updated_at
      ) VALUES ('expired-link-upload', 'cleanup-user', ?, ?, 'cleanup-project', 'link', 'Expired link', '[]', 'web', 'complete', 'expired-link-key', ?, ?, ?)`).bind(artifactId, versionId, now + 1, now, now),
    ]);

    await cleanupArtifacts(env, now);

    await expect(env.DB.prepare("SELECT id FROM artifacts WHERE id = ?").bind(artifactId).first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM artifact_versions WHERE id = ?").bind(versionId).first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM artifact_uploads WHERE id = 'expired-link-upload'").first()).resolves.toBeNull();
    await expect(env.DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").bind("cleanup-project", "cleanup-user").run()).resolves.toMatchObject({ meta: { changes: 1 } });
  });

  it("does not delete a soft-deleted artifact restored while cleanup reserves it", async () => {
    const artifact = await seedArtifact("race-restored-artifact", now - recoveryMs - 1);
    let recovered = false;
    const racingEnv = {
      ...env,
      DB: {
        prepare(query: string) {
          const statement = env.DB.prepare(query);
          if (query.includes("UPDATE artifacts SET cleanup_started_at")) {
            return {
              bind(...values: unknown[]) {
                const bound = statement.bind(...values);
                return {
                  ...bound,
                  async run() {
                    if (!recovered) {
                      recovered = true;
                      await env.DB.prepare("UPDATE artifacts SET deleted_at = NULL WHERE id = ?").bind("race-restored-artifact").run();
                    }
                    return bound.run();
                  },
                };
              },
            };
          }
          return statement;
        },
      },
    } as unknown as Env;

    await cleanupArtifacts(racingEnv, now);

    expect(recovered).toBe(true);
    await expect(env.DB.prepare("SELECT deleted_at FROM artifacts WHERE id = 'race-restored-artifact'").first()).resolves.toEqual({ deleted_at: null });
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_files WHERE r2_key = ?").bind(artifact.key).first()).resolves.not.toBeNull();
    await expect(env.ARTIFACTS.head(artifact.key)).resolves.not.toBeNull();
  });

  it("does not delete an upload finalized while cleanup reserves it", async () => {
    await seedUpload("race-finalized-upload", "finalizing", now - 1);
    const key = "artifacts/artifact-race-finalized-upload/versions/version-race-finalized-upload/index.html";
    await env.ARTIFACTS.put(key, "live");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, 'index.html', ?, 'text/html', 4, ?, ?)").bind("race-finalized-upload", key, "f".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, 'cleanup-user', 4, ?, ?, ?)").bind(key, "race-finalized-upload", "f".repeat(64), now - 1, now),
    ]);
    let finalized = false;
    const racingEnv = {
      ...env,
      DB: {
        prepare(query: string) {
          const statement = env.DB.prepare(query);
          if (query.includes("UPDATE artifact_uploads SET status = 'cleaning'")) {
            return {
              bind(...values: unknown[]) {
                const bound = statement.bind(...values);
                return {
                  ...bound,
                  async run() {
                    if (!finalized) {
                      finalized = true;
                      await env.DB.prepare("UPDATE artifact_uploads SET status = 'complete', expires_at = ? WHERE id = ?").bind(now + 60_000, "race-finalized-upload").run();
                    }
                    return bound.run();
                  },
                };
              },
            };
          }
          return statement;
        },
      },
    } as unknown as Env;

    await cleanupArtifacts(racingEnv, now);

    expect(finalized).toBe(true);
    await expect(env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = 'race-finalized-upload'").first()).resolves.toEqual({ status: "complete" });
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_upload_files WHERE r2_key = ?").bind(key).first()).resolves.not.toBeNull();
    await expect(env.ARTIFACTS.head(key)).resolves.not.toBeNull();
  });

  it("removes only expired upload state, orphan leases, and retained soft deletes", async () => {
    await seedUpload("pending-expired", "pending", now - 1);
    await seedUpload("finalizing-expired", "finalizing", now - 1);
    await seedUpload("failed-expired", "failed", now - 1);
    await seedUpload("aborted-expired", "aborted", now - 1);
    await seedUpload("pending-live", "pending", now + 1);
    await seedUpload("finalizing-live", "finalizing", now + 1);
    await seedUpload("failed-live", "failed", now + 1);
    await seedUpload("aborted-live", "aborted", now + 1);

    for (const id of [
      "pending-expired",
      "finalizing-expired",
      "failed-expired",
      "aborted-expired",
      "pending-live",
      "finalizing-live",
      "failed-live",
      "aborted-live",
    ]) {
      const key = `artifacts/artifact-${id}/versions/version-${id}/index.html`;
      await env.ARTIFACTS.put(key, id);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, 'index.html', ?, 'text/html', 1, ?, ?)").bind(id, key, "a".repeat(64), now),
        env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, 'cleanup-user', 1, ?, ?, ?)").bind(key, id, "a".repeat(64), id.endsWith("-live") ? now + 1 : now - 1, now),
      ]);
    }

    const orphanKey = "artifacts/orphan/versions/orphan-version/index.html";
    await env.ARTIFACTS.put(orphanKey, "orphan");
    await env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, 'cleanup-user', 6, ?, ?, ?)").bind(orphanKey, "b".repeat(64), now - 1, now).run();
    const absentOrphanKey = "artifacts/absent/versions/absent-version/index.html";
    await env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, 'cleanup-user', 0, ?, ?, ?)").bind(absentOrphanKey, "c".repeat(64), now - 1, now).run();

    const expired = await seedArtifact("expired-artifact", now - recoveryMs - 1);
    const recent = await seedArtifact("recent-artifact", now - recoveryMs + 1);
    const live = await seedArtifact("live-artifact", null);

    await cleanupArtifacts(env, now);
    await cleanupArtifacts(env, now);

    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_uploads WHERE id LIKE '%-expired'").first<{ count: number }>()).resolves.toEqual({ count: 0 });
    await expect(env.DB.prepare("SELECT id FROM artifact_uploads WHERE id = 'pending-live'").first()).resolves.not.toBeNull();
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_uploads WHERE id LIKE '%-live'").first<{ count: number }>()).resolves.toEqual({ count: 4 });
    await expect(env.ARTIFACTS.head("artifacts/artifact-pending-live/versions/version-pending-live/index.html")).resolves.not.toBeNull();
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_object_leases WHERE r2_key IN (?, ?)").bind(orphanKey, absentOrphanKey).first<{ count: number }>()).resolves.toEqual({ count: 0 });
    await expect(env.ARTIFACTS.head(orphanKey)).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM artifacts WHERE id = 'expired-artifact'").first()).resolves.toBeNull();
    await expect(env.ARTIFACTS.head(expired.key)).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM artifacts WHERE id = 'recent-artifact'").first()).resolves.not.toBeNull();
    await expect(env.ARTIFACTS.head(recent.key)).resolves.not.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM artifacts WHERE id = 'live-artifact'").first()).resolves.not.toBeNull();
    await expect(env.ARTIFACTS.head(live.key)).resolves.not.toBeNull();
  });

  it("keeps D1 state when an R2 delete fails and retries it later", async () => {
    const key = "artifacts/retry/versions/retry-version/index.html";
    await env.ARTIFACTS.put(key, "retry");
    await env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, 'cleanup-user', 5, ?, ?, ?)").bind(key, "d".repeat(64), now - 1, now).run();
    const failingEnv = {
      ...env,
      ARTIFACTS: {
        delete: async () => { throw new Error("temporary R2 failure"); },
      },
    } as unknown as Env;

    await cleanupArtifacts(failingEnv, now);
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE r2_key = ?").bind(key).first()).resolves.not.toBeNull();
    await expect(env.ARTIFACTS.head(key)).resolves.not.toBeNull();

    await cleanupArtifacts(env, now);
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE r2_key = ?").bind(key).first()).resolves.toBeNull();
    await expect(env.ARTIFACTS.head(key)).resolves.toBeNull();
  });

  it("bounds each cleanup category", async () => {
    for (const id of ["bound-a", "bound-b"]) {
      const key = `artifacts/${id}/versions/${id}/index.html`;
      await env.ARTIFACTS.put(key, id);
      await env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, 'cleanup-user', 1, ?, ?, ?)").bind(key, "e".repeat(64), now - 1, now).run();
    }

    await cleanupArtifacts(env, now, 1);
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_object_leases WHERE r2_key LIKE 'artifacts/bound-%'").first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });

});
