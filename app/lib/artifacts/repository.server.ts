import { ArtifactError, type ArtifactPackageSource, type ArtifactType } from "./contracts";
import { artifactObjectKey } from "./object-store.server";

type StoredArtifact = {
  id: string;
  user_id: string;
  project_id: string;
  type: ArtifactType;
  title: string;
  description: string | null;
  visibility: "private" | "gallery" | "public";
  current_version_id: string | null;
  gallery_version_id: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
};

type StoredVersion = {
  id: string;
  artifact_id: string;
  version_number: number;
  source: "web" | "mcp";
  entry_path: string | null;
  external_url: string | null;
  allowed_data_origins: string;
  file_count: number;
  total_bytes: number;
  created_by: string;
  created_at: number;
};

type ArtifactWrite = {
  id: string;
  projectId: string;
  type: ArtifactType;
  title: string;
  description: string | null;
};

export type NewArtifactFinalization = {
  uploadId: string;
  now: number;
};

export type ExistingVersionFinalization = {
  uploadId: string;
  now: number;
};

export type NewLinkFinalization = {
  artifact: ArtifactWrite;
  versionId: string;
  source: ArtifactPackageSource;
  externalUrl: string;
  allowedDataOrigins: string;
  now: number;
};

export async function findOwnedProject(env: Env, userId: string, projectId: string) {
  return env.DB.prepare(
    "SELECT * FROM projects WHERE id = ? AND user_id = ? LIMIT 1",
  ).bind(projectId, userId).first();
}

export async function findOwnedUpload(env: Env, userId: string, uploadId: string) {
  return env.DB.prepare(
    "SELECT * FROM artifact_uploads WHERE id = ? AND user_id = ? LIMIT 1",
  ).bind(uploadId, userId).first();
}

export async function findOwnedArtifact(env: Env, userId: string, artifactId: string): Promise<StoredArtifact | null> {
  return env.DB.prepare(
    "SELECT * FROM artifacts WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1",
  ).bind(artifactId, userId).first<StoredArtifact>();
}

export async function findOwnedVersion(
  env: Env,
  userId: string,
  artifactId: string,
  versionId: string,
): Promise<StoredVersion | null> {
  return env.DB.prepare(
    `SELECT v.* FROM artifact_versions v
     INNER JOIN artifacts a ON a.id = v.artifact_id
     WHERE v.id = ? AND v.artifact_id = ? AND a.id = ? AND a.user_id = ? AND a.deleted_at IS NULL
     LIMIT 1`,
  ).bind(versionId, artifactId, artifactId, userId).first<StoredVersion>();
}

export async function findOwnedLease(env: Env, userId: string, r2Key: string) {
  return env.DB.prepare(
    "SELECT * FROM artifact_object_leases WHERE r2_key = ? AND user_id = ? LIMIT 1",
  ).bind(r2Key, userId).first();
}

export async function findOwnedIdempotency(
  env: Env,
  userId: string,
  operation: string,
  targetKey: string,
  idempotencyKey: string,
) {
  return env.DB.prepare(
    `SELECT * FROM artifact_idempotency
     WHERE user_id = ? AND operation = ? AND target_key = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(userId, operation, targetKey, idempotencyKey).first();
}

export async function findGalleryArtifact(
  env: Env,
  artifactId: string,
): Promise<{ artifact: StoredArtifact; version: StoredVersion } | null> {
  const row = await env.DB.prepare(
    `SELECT
       a.id AS artifact_id, a.user_id AS artifact_user_id, a.project_id AS artifact_project_id,
       a.type AS artifact_type, a.title AS artifact_title, a.description AS artifact_description,
       a.visibility AS artifact_visibility, a.current_version_id AS artifact_current_version_id,
       a.gallery_version_id AS artifact_gallery_version_id, a.deleted_at AS artifact_deleted_at,
       a.created_at AS artifact_created_at, a.updated_at AS artifact_updated_at,
       v.id AS version_id, v.artifact_id AS version_artifact_id, v.version_number,
       v.source, v.entry_path, v.external_url, v.allowed_data_origins, v.file_count,
       v.total_bytes, v.created_by, v.created_at AS version_created_at
     FROM artifacts a
     INNER JOIN artifact_versions v ON v.id = a.gallery_version_id AND v.artifact_id = a.id
     WHERE a.id = ? AND a.visibility = 'gallery' AND a.deleted_at IS NULL
     LIMIT 1`,
  ).bind(artifactId).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    artifact: {
      id: row.artifact_id as string,
      user_id: row.artifact_user_id as string,
      project_id: row.artifact_project_id as string,
      type: row.artifact_type as ArtifactType,
      title: row.artifact_title as string,
      description: row.artifact_description as string | null,
      visibility: row.artifact_visibility as StoredArtifact["visibility"],
      current_version_id: row.artifact_current_version_id as string | null,
      gallery_version_id: row.artifact_gallery_version_id as string | null,
      deleted_at: row.artifact_deleted_at as number | null,
      created_at: row.artifact_created_at as number,
      updated_at: row.artifact_updated_at as number,
    },
    version: {
      id: row.version_id as string,
      artifact_id: row.version_artifact_id as string,
      version_number: row.version_number as number,
      source: row.source as StoredVersion["source"],
      entry_path: row.entry_path as string | null,
      external_url: row.external_url as string | null,
      allowed_data_origins: row.allowed_data_origins as string,
      file_count: row.file_count as number,
      total_bytes: row.total_bytes as number,
      created_by: row.created_by as string,
      created_at: row.version_created_at as number,
    },
  };
}

export async function markOwnedUploadAborted(
  env: Env,
  userId: string,
  uploadId: string,
  now: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE artifact_uploads SET status = 'aborted', updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('pending', 'finalizing')",
  ).bind(now, uploadId, userId).run();
  return result.meta.changes > 0;
}

function stateConflict(error: unknown): never {
  if (error instanceof Error && /UNIQUE constraint failed: artifact_versions\.artifact_id, artifact_versions\.version_number/u.test(error.message)) {
    throw new ArtifactError("state_conflict");
  }
  throw error;
}

function databaseSource(source: ArtifactPackageSource): "web" | "mcp" {
  return source === "browser" ? "web" : "mcp";
}

const ownedFinalizingManifestGuard = `
  AND EXISTS (
    SELECT 1 FROM artifact_upload_files f
    WHERE f.upload_id = u.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM artifact_upload_files f
    WHERE f.upload_id = u.id AND (
      f.r2_key <> ('artifacts/' || u.artifact_id || '/versions/' || u.version_id || '/' || f.path)
      OR NOT EXISTS (
        SELECT 1 FROM artifact_object_leases l
        WHERE l.r2_key = f.r2_key AND l.upload_id = u.id AND l.user_id = u.user_id
          AND l.byte_size = f.byte_size AND l.sha256 = f.sha256 AND l.expires_at > ?
      )
    )
  )`;

type StoredUploadManifestFile = {
  artifactId: string;
  versionId: string;
  path: string;
  r2Key: string;
};

async function assertOwnedFinalizingManifest(
  env: Env,
  userId: string,
  uploadId: string,
  now: number,
): Promise<void> {
  const files = await env.DB.prepare(
    `SELECT u.artifact_id AS artifactId, u.version_id AS versionId, f.path, f.r2_key AS r2Key
     FROM artifact_uploads u
     INNER JOIN artifact_upload_files f ON f.upload_id = u.id
     WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing' AND u.expires_at > ?`,
  ).bind(uploadId, userId, now).all<StoredUploadManifestFile>();

  if (files.results.length === 0) throw new ArtifactError("state_conflict");

  for (const file of files.results) {
    try {
      if (artifactObjectKey(file.artifactId, file.versionId, file.path) !== file.r2Key) {
        throw new ArtifactError("state_conflict");
      }
    } catch {
      throw new ArtifactError("state_conflict");
    }
  }
}

export async function finalizeNewArtifact(
  env: Env,
  userId: string,
  input: NewArtifactFinalization,
): Promise<void> {
  try {
    await assertOwnedFinalizingManifest(env, userId, input.uploadId, input.now);
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO artifacts (id, user_id, project_id, type, title, description, visibility, current_version_id, created_at, updated_at)
         SELECT u.artifact_id, u.user_id, u.project_id, u.type, u.title, u.description, 'private', NULL, ?, ?
         FROM artifact_uploads u
         WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing' AND u.expires_at > ?
           ${ownedFinalizingManifestGuard}`,
      ).bind(input.now, input.now, input.uploadId, userId, input.now, input.now),
      env.DB.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at)
         SELECT u.version_id, u.artifact_id, 1, u.source,
           CASE WHEN u.type = 'html' THEN 'index.html' ELSE NULL END,
           NULL, u.allowed_data_origins, COUNT(f.r2_key), COALESCE(SUM(f.byte_size), 0), u.user_id, ?
         FROM artifact_uploads u
         INNER JOIN artifact_upload_files f ON f.upload_id = u.id
         WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing' AND u.expires_at > ?
           ${ownedFinalizingManifestGuard}
         GROUP BY u.id`,
      ).bind(input.now, input.uploadId, userId, input.now, input.now),
      env.DB.prepare(
        `INSERT INTO artifact_files (version_id, path, r2_key, mime_type, byte_size, sha256, created_at)
         SELECT u.version_id, f.path, f.r2_key, f.mime_type, f.byte_size, f.sha256, ?
         FROM artifact_uploads u
         INNER JOIN artifact_upload_files f ON f.upload_id = u.id
         WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing' AND u.expires_at > ?
           ${ownedFinalizingManifestGuard}`,
      ).bind(input.now, input.uploadId, userId, input.now, input.now),
      env.DB.prepare(
        `UPDATE artifacts SET current_version_id = (
           SELECT version_id FROM artifact_uploads
           WHERE id = ? AND user_id = ? AND status = 'finalizing' AND expires_at > ?
         ), updated_at = ?
         WHERE id = (SELECT artifact_id FROM artifact_uploads WHERE id = ? AND user_id = ? AND status = 'finalizing' AND expires_at > ?)
           AND user_id = ? AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM artifact_versions v
             WHERE v.id = (
               SELECT version_id FROM artifact_uploads
               WHERE id = ? AND user_id = ? AND status = 'finalizing' AND expires_at > ?
             ) AND v.artifact_id = artifacts.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM artifact_upload_files f
             WHERE f.upload_id = ? AND NOT EXISTS (
               SELECT 1 FROM artifact_object_leases l
               WHERE l.r2_key = f.r2_key AND l.upload_id = ? AND l.user_id = ?
                 AND l.byte_size = f.byte_size AND l.sha256 = f.sha256 AND l.expires_at > ?
             )
           )`,
      ).bind(input.uploadId, userId, input.now, input.now, input.uploadId, userId, input.now, userId, input.uploadId, userId, input.now, input.uploadId, input.uploadId, userId, input.now),
      env.DB.prepare(
        `UPDATE artifact_uploads SET status = 'complete', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'finalizing' AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM artifact_versions v
             WHERE v.id = artifact_uploads.version_id AND v.artifact_id = artifact_uploads.artifact_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM artifact_upload_files f
             WHERE f.upload_id = artifact_uploads.id AND NOT EXISTS (
               SELECT 1 FROM artifact_object_leases l
               WHERE l.r2_key = f.r2_key AND l.upload_id = artifact_uploads.id AND l.user_id = artifact_uploads.user_id
                 AND l.byte_size = f.byte_size AND l.sha256 = f.sha256 AND l.expires_at > ?
             )
           )`,
      ).bind(input.now, input.uploadId, userId, input.now, input.now),
      env.DB.prepare(
        `DELETE FROM artifact_object_leases
         WHERE upload_id = ? AND user_id = ? AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM artifact_uploads u
             WHERE u.id = artifact_object_leases.upload_id
               AND u.user_id = artifact_object_leases.user_id
               AND u.status = 'complete' AND u.expires_at > ?
           )
           AND EXISTS (
             SELECT 1 FROM artifact_upload_files f
             WHERE f.upload_id = artifact_object_leases.upload_id AND f.r2_key = artifact_object_leases.r2_key
           )`,
      ).bind(input.uploadId, userId, input.now, input.now),
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1 || results[2].meta.changes < 1 || results[3].meta.changes !== 1 || results[4].meta.changes !== 1) {
      throw new ArtifactError("state_conflict");
    }
  } catch (error) {
    stateConflict(error);
  }
}

export async function finalizeExistingArtifactVersion(
  env: Env,
  userId: string,
  input: ExistingVersionFinalization,
): Promise<void> {
  try {
    await assertOwnedFinalizingManifest(env, userId, input.uploadId, input.now);
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at)
         SELECT u.version_id, a.id,
           COALESCE((SELECT MAX(version_number) FROM artifact_versions WHERE artifact_id = a.id), 0) + 1,
           u.source,
           CASE WHEN u.type = 'html' THEN 'index.html' ELSE NULL END,
           NULL, u.allowed_data_origins,
           (SELECT COUNT(*) FROM artifact_upload_files WHERE upload_id = u.id),
           COALESCE((SELECT SUM(byte_size) FROM artifact_upload_files WHERE upload_id = u.id), 0),
           u.user_id, ?
         FROM artifact_uploads u
         INNER JOIN artifacts a ON a.id = u.artifact_id AND a.user_id = u.user_id AND a.project_id = u.project_id AND a.type = u.type
         WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing' AND u.expires_at > ? AND a.deleted_at IS NULL
           ${ownedFinalizingManifestGuard}`,
      ).bind(input.now, input.uploadId, userId, input.now, input.now),
      env.DB.prepare(
        `INSERT INTO artifact_files (version_id, path, r2_key, mime_type, byte_size, sha256, created_at)
         SELECT u.version_id, f.path, f.r2_key, f.mime_type, f.byte_size, f.sha256, ?
         FROM artifact_uploads u
         INNER JOIN artifact_upload_files f ON f.upload_id = u.id
         WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing' AND u.expires_at > ?
           ${ownedFinalizingManifestGuard}`,
      ).bind(input.now, input.uploadId, userId, input.now, input.now),
      env.DB.prepare(
        `UPDATE artifacts SET current_version_id = (
           SELECT version_id FROM artifact_uploads
           WHERE id = ? AND user_id = ? AND status = 'finalizing' AND expires_at > ?
         ), updated_at = ?
         WHERE id = (SELECT artifact_id FROM artifact_uploads WHERE id = ? AND user_id = ? AND status = 'finalizing' AND expires_at > ?)
           AND user_id = ? AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM artifact_versions v
             WHERE v.id = (
               SELECT version_id FROM artifact_uploads
               WHERE id = ? AND user_id = ? AND status = 'finalizing' AND expires_at > ?
             ) AND v.artifact_id = artifacts.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM artifact_upload_files f
             WHERE f.upload_id = ? AND NOT EXISTS (
               SELECT 1 FROM artifact_object_leases l
               WHERE l.r2_key = f.r2_key AND l.upload_id = ? AND l.user_id = ?
                 AND l.byte_size = f.byte_size AND l.sha256 = f.sha256 AND l.expires_at > ?
             )
           )`,
      ).bind(input.uploadId, userId, input.now, input.now, input.uploadId, userId, input.now, userId, input.uploadId, userId, input.now, input.uploadId, input.uploadId, userId, input.now),
      env.DB.prepare(
        `UPDATE artifact_uploads SET status = 'complete', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'finalizing' AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM artifact_versions v
             WHERE v.id = artifact_uploads.version_id AND v.artifact_id = artifact_uploads.artifact_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM artifact_upload_files f
             WHERE f.upload_id = artifact_uploads.id AND NOT EXISTS (
               SELECT 1 FROM artifact_object_leases l
               WHERE l.r2_key = f.r2_key AND l.upload_id = artifact_uploads.id AND l.user_id = artifact_uploads.user_id
                 AND l.byte_size = f.byte_size AND l.sha256 = f.sha256 AND l.expires_at > ?
             )
           )`,
      ).bind(input.now, input.uploadId, userId, input.now, input.now),
      env.DB.prepare(
        `DELETE FROM artifact_object_leases
         WHERE upload_id = ? AND user_id = ? AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM artifact_uploads u
             WHERE u.id = artifact_object_leases.upload_id
               AND u.user_id = artifact_object_leases.user_id
               AND u.status = 'complete' AND u.expires_at > ?
           )
           AND EXISTS (
             SELECT 1 FROM artifact_upload_files f
             WHERE f.upload_id = artifact_object_leases.upload_id AND f.r2_key = artifact_object_leases.r2_key
           )`,
      ).bind(input.uploadId, userId, input.now, input.now),
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes < 1 || results[2].meta.changes !== 1 || results[3].meta.changes !== 1) {
      throw new ArtifactError("state_conflict");
    }
  } catch (error) {
    stateConflict(error);
  }
}

export async function finalizeNewLinkArtifact(
  env: Env,
  userId: string,
  input: NewLinkFinalization,
): Promise<void> {
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO artifacts (id, user_id, project_id, type, title, description, visibility, current_version_id, created_at, updated_at)
         SELECT ?, ?, p.id, ?, ?, ?, 'private', NULL, ?, ?
         FROM projects p
         WHERE p.id = ? AND p.user_id = ?`,
      ).bind(input.artifact.id, userId, input.artifact.type, input.artifact.title, input.artifact.description, input.now, input.now, input.artifact.projectId, userId),
      env.DB.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at)
         SELECT ?, a.id, 1, ?, NULL, ?, ?, 0, 0, ?, ?
         FROM artifacts a
         WHERE a.id = ? AND a.user_id = ? AND a.project_id = ? AND a.deleted_at IS NULL`,
      ).bind(input.versionId, databaseSource(input.source), input.externalUrl, input.allowedDataOrigins, userId, input.now, input.artifact.id, userId, input.artifact.projectId),
      env.DB.prepare(
        "UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      ).bind(input.versionId, input.now, input.artifact.id, userId),
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1 || results[2].meta.changes !== 1) {
      throw new ArtifactError("state_conflict");
    }
  } catch (error) {
    stateConflict(error);
  }
}
