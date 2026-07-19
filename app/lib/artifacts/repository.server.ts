import { ArtifactError, type ArtifactPackageSource, type ArtifactType } from "./contracts";

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

export type ArtifactFileWrite = {
  path: string;
  r2Key: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
};

type VersionWrite = {
  id: string;
  source: ArtifactPackageSource;
  entryPath: string | null;
  externalUrl: string | null;
  allowedDataOrigins: string;
  fileCount: number;
  totalBytes: number;
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
  artifact: ArtifactWrite;
  version: VersionWrite;
  files: readonly ArtifactFileWrite[];
  now: number;
};

export type ExistingVersionFinalization = {
  uploadId: string;
  artifactId: string;
  version: VersionWrite;
  files: readonly ArtifactFileWrite[];
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

function fileStatements(env: Env, versionId: string, files: readonly ArtifactFileWrite[], now: number) {
  return files.map((file) => env.DB.prepare(
    `INSERT INTO artifact_files (version_id, path, r2_key, mime_type, byte_size, sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(versionId, file.path, file.r2Key, file.mimeType, file.byteSize, file.sha256, now));
}

function leaseDeleteStatements(env: Env, userId: string, files: readonly ArtifactFileWrite[]) {
  return files.map((file) => env.DB.prepare(
    "DELETE FROM artifact_object_leases WHERE r2_key = ? AND user_id = ?",
  ).bind(file.r2Key, userId));
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

export async function finalizeNewArtifact(
  env: Env,
  userId: string,
  input: NewArtifactFinalization,
): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO artifacts (id, user_id, project_id, type, title, description, visibility, current_version_id, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, 'private', NULL, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM artifact_uploads
           WHERE id = ? AND user_id = ? AND status = 'finalizing'
         )`,
      ).bind(input.artifact.id, userId, input.artifact.projectId, input.artifact.type, input.artifact.title, input.artifact.description, input.now, input.now, input.uploadId, userId),
      env.DB.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(input.version.id, input.artifact.id, databaseSource(input.version.source), input.version.entryPath, input.version.externalUrl, input.version.allowedDataOrigins, input.version.fileCount, input.version.totalBytes, userId, input.now),
      ...fileStatements(env, input.version.id, input.files, input.now),
      env.DB.prepare(
        "UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      ).bind(input.version.id, input.now, input.artifact.id, userId),
      env.DB.prepare(
        "UPDATE artifact_uploads SET status = 'complete', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'finalizing'",
      ).bind(input.now, input.uploadId, userId),
      ...leaseDeleteStatements(env, userId, input.files),
    ]);
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
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at)
         SELECT ?, a.id, COALESCE(MAX(v.version_number), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?
         FROM artifacts a
         LEFT JOIN artifact_versions v ON v.artifact_id = a.id
         WHERE a.id = ? AND a.user_id = ? AND a.deleted_at IS NULL
         GROUP BY a.id`,
      ).bind(input.version.id, databaseSource(input.version.source), input.version.entryPath, input.version.externalUrl, input.version.allowedDataOrigins, input.version.fileCount, input.version.totalBytes, userId, input.now, input.artifactId, userId),
      ...fileStatements(env, input.version.id, input.files, input.now),
      env.DB.prepare(
        "UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      ).bind(input.version.id, input.now, input.artifactId, userId),
      env.DB.prepare(
        "UPDATE artifact_uploads SET status = 'complete', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'finalizing'",
      ).bind(input.now, input.uploadId, userId),
      ...leaseDeleteStatements(env, userId, input.files),
    ]);
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
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO artifacts (id, user_id, project_id, type, title, description, visibility, current_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'private', NULL, ?, ?)`,
      ).bind(input.artifact.id, userId, input.artifact.projectId, input.artifact.type, input.artifact.title, input.artifact.description, input.now, input.now),
      env.DB.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at)
         VALUES (?, ?, 1, ?, NULL, ?, ?, 0, 0, ?, ?)`,
      ).bind(input.versionId, input.artifact.id, databaseSource(input.source), input.externalUrl, input.allowedDataOrigins, userId, input.now),
      env.DB.prepare(
        "UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      ).bind(input.versionId, input.now, input.artifact.id, userId),
    ]);
  } catch (error) {
    stateConflict(error);
  }
}
