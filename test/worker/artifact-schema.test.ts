import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const now = 1_784_200_000_000;

async function expectConstraint(sql: string, bindings: unknown[] = []) {
  await expect(env.DB.prepare(sql).bind(...bindings).run()).rejects.toThrow();
}

describe("artifact persistence schema", () => {
  it("creates the artifact tables with ownership and idempotency constraints", async () => {
    const tables = await env.DB.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name IN (?, ?, ?, ?, ?, ?, ?)
       ORDER BY name`,
    )
      .bind(
        "artifacts",
        "artifact_versions",
        "artifact_files",
        "artifact_uploads",
        "artifact_upload_files",
        "artifact_object_leases",
        "artifact_idempotency",
      )
      .all<{ name: string }>();

    expect(tables.results.map((table) => table.name)).toEqual([
      "artifact_files",
      "artifact_idempotency",
      "artifact_object_leases",
      "artifact_upload_files",
      "artifact_uploads",
      "artifact_versions",
      "artifacts",
    ]);

    const foreignKeys = await env.DB.prepare("PRAGMA foreign_key_list(artifacts)").all<{
      from: string;
      table: string;
      on_delete: string;
    }>();

    expect(
      foreignKeys.results.find((foreignKey) => foreignKey.from === "project_id"),
    ).toMatchObject({ table: "projects", on_delete: "RESTRICT" });

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, role, stage, created_at) VALUES (?, ?, 'user', 'invited', ?)",
      ).bind("artifact-user", "artifact-user@example.com", now),
      env.DB.prepare(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)",
      ).bind("artifact-project", "artifact-user", "Artifact project", now, now),
      env.DB.prepare(
        `INSERT INTO artifacts (
          id, user_id, project_id, type, title, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?)`,
      ).bind("artifact-1", "artifact-user", "artifact-project", "Artifact", now, now),
      env.DB.prepare(
        `INSERT INTO artifact_versions (
          id, artifact_id, version_number, source, allowed_data_origins,
          file_count, total_bytes, created_by, created_at
        ) VALUES (?, ?, 1, 'web', '[]', 0, 0, ?, ?)`,
      ).bind("artifact-version-1", "artifact-1", "artifact-user", now),
      env.DB.prepare(
        `INSERT INTO artifact_uploads (
          id, user_id, artifact_id, version_id, project_id, type, title,
          allowed_data_origins, source, status, idempotency_key, expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'pending', ?, ?, ?, ?)`,
      ).bind(
        "artifact-upload-1",
        "artifact-user",
        "artifact-2",
        "artifact-version-2",
        "artifact-project",
        "Pending artifact",
        "upload-key",
        now + 60_000,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifact_files (
          version_id, path, r2_key, mime_type, byte_size, sha256, created_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).bind(
        "artifact-version-1",
        "index.html",
        "artifacts/artifact-1/versions/artifact-version-1/index.html",
        "text/html",
        "a".repeat(64),
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifact_upload_files (
          upload_id, path, r2_key, mime_type, byte_size, sha256, created_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).bind(
        "artifact-upload-1",
        "index.html",
        "artifacts/artifact-2/versions/artifact-version-2/index.html",
        "text/html",
        "b".repeat(64),
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifact_object_leases (
          r2_key, user_id, byte_size, sha256, expires_at, created_at
        ) VALUES (?, ?, 0, ?, ?, ?)`,
      ).bind(
        "artifacts/artifact-3/versions/artifact-version-3/index.html",
        "artifact-user",
        "c".repeat(64),
        now + 60_000,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifact_idempotency (
          user_id, operation, target_key, idempotency_key, fingerprint,
          artifact_id, version_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "artifact-user",
        "create_artifact",
        "artifact-project",
        "mutation-key",
        "fingerprint",
        "artifact-1",
        "artifact-version-1",
        now,
      ),
    ]);

    await expectConstraint(
      `INSERT INTO artifact_versions (
        id, artifact_id, version_number, source, allowed_data_origins,
        file_count, total_bytes, created_by, created_at
      ) VALUES (?, ?, 1, 'web', '[]', 0, 0, ?, ?)`,
      ["artifact-version-duplicate", "artifact-1", "artifact-user", now],
    );
    await expectConstraint(
      `INSERT INTO artifact_files (
        version_id, path, r2_key, mime_type, byte_size, sha256, created_at
      ) VALUES (?, 'index.html', ?, 'text/html', 0, ?, ?)`,
      [
        "artifact-version-1",
        "artifacts/artifact-1/versions/artifact-version-1/duplicate.html",
        "d".repeat(64),
        now,
      ],
    );
    await expectConstraint(
      `INSERT INTO artifact_upload_files (
        upload_id, path, r2_key, mime_type, byte_size, sha256, created_at
      ) VALUES (?, ?, ?, 'text/html', 0, ?, ?)`,
      [
        "artifact-upload-1",
        "duplicate.html",
        "artifacts/artifact-2/versions/artifact-version-2/index.html",
        "e".repeat(64),
        now,
      ],
    );
    await expectConstraint(
      `INSERT INTO artifact_upload_files (
        upload_id, path, r2_key, mime_type, byte_size, sha256, created_at
      ) VALUES (?, 'index.html', ?, 'text/html', 0, ?, ?)`,
      [
        "artifact-upload-1",
        "artifacts/artifact-2/versions/artifact-version-2/other-index.html",
        "f".repeat(64),
        now,
      ],
    );
    await expectConstraint(
      `INSERT INTO artifact_uploads (
        id, user_id, artifact_id, version_id, type, title, allowed_data_origins,
        source, status, idempotency_key, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'html', ?, '[]', 'web', 'pending', ?, ?, ?, ?)`,
      [
        "artifact-upload-duplicate",
        "artifact-user",
        "artifact-3",
        "artifact-version-3",
        "Duplicate upload",
        "upload-key",
        now + 60_000,
        now,
        now,
      ],
    );
    await expectConstraint(
      `INSERT INTO artifact_idempotency (
        user_id, operation, target_key, idempotency_key, fingerprint,
        artifact_id, version_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "artifact-user",
        "create_artifact",
        "artifact-project",
        "mutation-key",
        "other-fingerprint",
        "artifact-1",
        "artifact-version-1",
        now,
      ],
    );
  });

  it("enforces artifact ownership, creation, immutability, and version pointers", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, role, stage, created_at) VALUES (?, ?, 'user', 'invited', ?)",
      ).bind("artifact-owner", "artifact-owner@example.com", now),
      env.DB.prepare(
        "INSERT INTO users (id, email, role, stage, created_at) VALUES (?, ?, 'user', 'invited', ?)",
      ).bind("artifact-other-user", "artifact-other-user@example.com", now),
      env.DB.prepare(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)",
      ).bind("artifact-owner-project", "artifact-owner", "Owner project", now, now),
      env.DB.prepare(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)",
      ).bind("artifact-owner-project-2", "artifact-owner", "Second owner project", now, now),
      env.DB.prepare(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)",
      ).bind("artifact-other-project", "artifact-other-user", "Other project", now, now),
      env.DB.prepare(
        `INSERT INTO artifacts (
          id, user_id, project_id, type, title, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?)`,
      ).bind(
        "artifact-owner-1",
        "artifact-owner",
        "artifact-owner-project",
        "Owner artifact",
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifacts (
          id, user_id, project_id, type, title, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?)`,
      ).bind(
        "artifact-owner-2",
        "artifact-owner",
        "artifact-owner-project",
        "Other owner artifact",
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifact_versions (
          id, artifact_id, version_number, source, allowed_data_origins,
          file_count, total_bytes, created_by, created_at
        ) VALUES (?, ?, 1, 'web', '[]', 0, 0, ?, ?)`,
      ).bind("artifact-owner-1-version", "artifact-owner-1", "artifact-owner", now),
      env.DB.prepare(
        `INSERT INTO artifact_versions (
          id, artifact_id, version_number, source, allowed_data_origins,
          file_count, total_bytes, created_by, created_at
        ) VALUES (?, ?, 1, 'web', '[]', 0, 0, ?, ?)`,
      ).bind("artifact-owner-2-version", "artifact-owner-2", "artifact-owner", now),
    ]);

    await expectConstraint(
      `INSERT INTO artifacts (
        id, user_id, project_id, type, title, visibility, created_at, updated_at
      ) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?)`,
      [
        "artifact-cross-owner",
        "artifact-owner",
        "artifact-other-project",
        "Cross-owner artifact",
        now,
        now,
      ],
    );
    await expectConstraint(
      `INSERT INTO artifacts (
        id, user_id, project_id, type, title, visibility, current_version_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?, ?)`,
      [
        "artifact-current-cross-pointer-at-create",
        "artifact-owner",
        "artifact-owner-project",
        "Cross current pointer",
        "artifact-owner-2-version",
        now,
        now,
      ],
    );
    await expectConstraint(
      `INSERT INTO artifacts (
        id, user_id, project_id, type, title, visibility, gallery_version_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?, ?)`,
      [
        "artifact-gallery-cross-pointer-at-create",
        "artifact-owner",
        "artifact-owner-project",
        "Cross gallery pointer",
        "artifact-owner-2-version",
        now,
        now,
      ],
    );
    await expectConstraint(
      `INSERT INTO artifacts (
        id, user_id, project_id, type, title, visibility, created_at, updated_at
      ) VALUES (?, ?, ?, 'html', ?, 'gallery', ?, ?)`,
      [
        "artifact-gallery-at-create",
        "artifact-owner",
        "artifact-owner-project",
        "Gallery artifact",
        now,
        now,
      ],
    );
    await expectConstraint(
      `INSERT INTO artifacts (
        id, user_id, project_id, type, title, visibility, created_at, updated_at
      ) VALUES (?, ?, ?, 'html', ?, 'public', ?, ?)`,
      [
        "artifact-public-at-create",
        "artifact-owner",
        "artifact-owner-project",
        "Public artifact",
        now,
        now,
      ],
    );
    await expectConstraint(
      `INSERT INTO artifacts (
        id, user_id, project_id, type, title, visibility, created_at, updated_at
      ) VALUES (?, ?, ?, 'unknown', ?, 'private', ?, ?)`,
      [
        "artifact-invalid-type",
        "artifact-owner",
        "artifact-owner-project",
        "Invalid artifact",
        now,
        now,
      ],
    );
    await expectConstraint(
      "UPDATE artifacts SET type = 'file' WHERE id = 'artifact-owner-1'",
    );
    await expectConstraint(
      "UPDATE artifacts SET project_id = 'artifact-owner-project-2' WHERE id = 'artifact-owner-1'",
    );
    await expectConstraint(
      "UPDATE artifacts SET user_id = 'artifact-other-user' WHERE id = 'artifact-owner-1'",
    );
    await expectConstraint(
      "UPDATE projects SET user_id = 'artifact-other-user' WHERE id = 'artifact-owner-project'",
    );
    await expectConstraint(
      "UPDATE artifacts SET current_version_id = 'artifact-owner-2-version' WHERE id = 'artifact-owner-1'",
    );
    await expectConstraint(
      "UPDATE artifacts SET gallery_version_id = 'artifact-owner-2-version' WHERE id = 'artifact-owner-1'",
    );
    await expectConstraint(
      `INSERT INTO artifact_versions (
        id, artifact_id, version_number, source, allowed_data_origins,
        file_count, total_bytes, created_by, created_at
      ) VALUES (?, ?, 2, 'unknown', '[]', 0, 0, ?, ?)`,
      ["artifact-invalid-source", "artifact-owner-1", "artifact-owner", now],
    );
    await expectConstraint(
      `INSERT INTO artifact_versions (
        id, artifact_id, version_number, source, allowed_data_origins,
        file_count, total_bytes, created_by, created_at
      ) VALUES (?, ?, 2, 'web', '[]', -1, 0, ?, ?)`,
      ["artifact-negative-count", "artifact-owner-1", "artifact-owner", now],
    );

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE artifacts SET current_version_id = ? WHERE id = ?",
      ).bind("artifact-owner-1-version", "artifact-owner-1"),
      env.DB.prepare(
        "UPDATE artifacts SET gallery_version_id = ? WHERE id = ?",
      ).bind("artifact-owner-1-version", "artifact-owner-1"),
    ]);
  });

  it("enforces upload project ownership and restricts artifact project deletion", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, role, stage, created_at) VALUES (?, ?, 'user', 'invited', ?)",
      ).bind("artifact-upload-owner", "artifact-upload-owner@example.com", now),
      env.DB.prepare(
        "INSERT INTO users (id, email, role, stage, created_at) VALUES (?, ?, 'user', 'invited', ?)",
      ).bind("artifact-upload-other", "artifact-upload-other@example.com", now),
      env.DB.prepare(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)",
      ).bind(
        "artifact-upload-owner-project",
        "artifact-upload-owner",
        "Upload owner project",
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)",
      ).bind(
        "artifact-upload-other-project",
        "artifact-upload-other",
        "Upload other project",
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)",
      ).bind(
        "artifact-delete-only-project",
        "artifact-upload-owner",
        "Artifact-only project",
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)",
      ).bind(
        "artifact-upload-only-project",
        "artifact-upload-owner",
        "Upload-only project",
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifacts (
          id, user_id, project_id, type, title, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?)`,
      ).bind(
        "artifact-delete-project-reference",
        "artifact-upload-owner",
        "artifact-upload-owner-project",
        "Project delete reference",
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifacts (
          id, user_id, project_id, type, title, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?)`,
      ).bind(
        "artifact-delete-only-reference",
        "artifact-upload-owner",
        "artifact-delete-only-project",
        "Artifact-only project reference",
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifact_uploads (
          id, user_id, artifact_id, version_id, project_id, type, title,
          allowed_data_origins, source, status, idempotency_key, expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'pending', ?, ?, ?, ?)`,
      ).bind(
        "artifact-upload-owner-pending",
        "artifact-upload-owner",
        "artifact-upload-owner-artifact",
        "artifact-upload-owner-version",
        "artifact-upload-owner-project",
        "Pending upload",
        "artifact-upload-owner-key",
        now + 60_000,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifact_uploads (
          id, user_id, artifact_id, version_id, project_id, type, title,
          allowed_data_origins, source, status, idempotency_key, expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'failed', ?, ?, ?, ?)`,
      ).bind(
        "artifact-upload-only-reference",
        "artifact-upload-owner",
        "artifact-upload-only-artifact",
        "artifact-upload-only-version",
        "artifact-upload-only-project",
        "Upload-only failed upload",
        "artifact-upload-only-key",
        now + 60_000,
        now,
        now,
      ),
    ]);

    await expectConstraint(
      `INSERT INTO artifact_uploads (
        id, user_id, artifact_id, version_id, project_id, type, title,
        allowed_data_origins, source, status, idempotency_key, expires_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'pending', ?, ?, ?, ?)`,
      [
        "artifact-upload-cross-owner",
        "artifact-upload-owner",
        "artifact-upload-cross-owner-artifact",
        "artifact-upload-cross-owner-version",
        "artifact-upload-other-project",
        "Cross-owner pending upload",
        "artifact-upload-cross-owner-key",
        now + 60_000,
        now,
        now,
      ],
    );
    await expectConstraint(
      "UPDATE artifact_uploads SET project_id = 'artifact-upload-other-project' WHERE id = 'artifact-upload-owner-pending'",
    );
    await expectConstraint(
      `INSERT INTO artifact_uploads (
        id, user_id, artifact_id, version_id, project_id, type, title,
        allowed_data_origins, source, status, idempotency_key, expires_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'failed', ?, ?, ?, ?)`,
      [
        "artifact-upload-cross-owner-failed",
        "artifact-upload-owner",
        "artifact-upload-cross-owner-failed-artifact",
        "artifact-upload-cross-owner-failed-version",
        "artifact-upload-other-project",
        "Cross-owner failed upload",
        "artifact-upload-cross-owner-failed-key",
        now + 60_000,
        now,
        now,
      ],
    );
    await expectConstraint(
      "UPDATE projects SET user_id = 'artifact-upload-other' WHERE id = 'artifact-upload-only-project'",
    );
    await expectConstraint(
      "DELETE FROM projects WHERE id = 'artifact-delete-only-project'",
    );
  });

  it("rejects raw updates to finalized artifact versions and files", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, role, stage, created_at) VALUES (?, ?, 'user', 'invited', ?)",
      ).bind("artifact-immutable-user", "artifact-immutable@example.com", now),
      env.DB.prepare(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)",
      ).bind(
        "artifact-immutable-project",
        "artifact-immutable-user",
        "Immutable project",
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifacts (
          id, user_id, project_id, type, title, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?)`,
      ).bind(
        "artifact-immutable",
        "artifact-immutable-user",
        "artifact-immutable-project",
        "Immutable artifact",
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifact_versions (
          id, artifact_id, version_number, source, entry_path, external_url,
          allowed_data_origins, file_count, total_bytes, created_by, created_at
        ) VALUES (?, ?, 1, 'web', ?, ?, '[]', 1, 10, ?, ?)`,
      ).bind(
        "artifact-immutable-version",
        "artifact-immutable",
        "index.html",
        "https://example.com/original",
        "artifact-immutable-user",
        now,
      ),
      env.DB.prepare(
        `INSERT INTO artifact_files (
          version_id, path, r2_key, mime_type, byte_size, sha256, created_at
        ) VALUES (?, ?, ?, ?, 10, ?, ?)`,
      ).bind(
        "artifact-immutable-version",
        "index.html",
        "artifacts/artifact-immutable/versions/artifact-immutable-version/index.html",
        "text/html",
        "a".repeat(64),
        now,
      ),
    ]);

    for (const statement of [
      "UPDATE artifact_versions SET entry_path = 'other.html' WHERE id = 'artifact-immutable-version'",
      "UPDATE artifact_versions SET external_url = 'https://example.com/other' WHERE id = 'artifact-immutable-version'",
      "UPDATE artifact_versions SET allowed_data_origins = '[\"https://api.example.com\"]' WHERE id = 'artifact-immutable-version'",
      "UPDATE artifact_versions SET file_count = 2 WHERE id = 'artifact-immutable-version'",
      "UPDATE artifact_versions SET total_bytes = 20 WHERE id = 'artifact-immutable-version'",
      "UPDATE artifact_files SET r2_key = 'artifacts/other/index.html' WHERE r2_key = 'artifacts/artifact-immutable/versions/artifact-immutable-version/index.html'",
      "UPDATE artifact_files SET mime_type = 'application/octet-stream' WHERE r2_key = 'artifacts/artifact-immutable/versions/artifact-immutable-version/index.html'",
      "UPDATE artifact_files SET byte_size = 20 WHERE r2_key = 'artifacts/artifact-immutable/versions/artifact-immutable-version/index.html'",
      "UPDATE artifact_files SET sha256 = 'b' WHERE r2_key = 'artifacts/artifact-immutable/versions/artifact-immutable-version/index.html'",
    ]) {
      await expectConstraint(statement);
    }

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE artifacts SET current_version_id = ? WHERE id = ?",
      ).bind("artifact-immutable-version", "artifact-immutable"),
      env.DB.prepare(
        "UPDATE artifacts SET gallery_version_id = ? WHERE id = ?",
      ).bind("artifact-immutable-version", "artifact-immutable"),
    ]);
  });
});
