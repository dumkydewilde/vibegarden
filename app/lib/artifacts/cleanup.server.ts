import { ArtifactError, ARTIFACT_LIMITS } from "./contracts";
import { deleteKeys } from "./object-store.server";
import { recordArtifactEvent, writeArtifactMetric } from "./observability.server";

type CleanupRow = {
  r2Key: string;
  byteSize: number;
  uploadId: string | null;
  artifactId: string | null;
  versionId: string | null;
};

type CleanupCategory = "expired_upload" | "expired_lease" | "expired_artifact";

type CleanupResult = Record<CleanupCategory, {
  attempted: number;
  deleted: number;
  bytes: number;
  failed: number;
}>;

function boundedBatchSize(batchSize: number): number {
  if (!Number.isFinite(batchSize)) return 100;
  return Math.max(1, Math.min(Math.floor(batchSize), 100));
}

function emptyResult(): CleanupResult {
  return {
    expired_upload: { attempted: 0, deleted: 0, bytes: 0, failed: 0 },
    expired_lease: { attempted: 0, deleted: 0, bytes: 0, failed: 0 },
    expired_artifact: { attempted: 0, deleted: 0, bytes: 0, failed: 0 },
  };
}

function errorCode(error: unknown): string {
  return error instanceof ArtifactError ? error.code : "storage_unavailable";
}

function eventIds(row: CleanupRow) {
  return {
    ...(row.uploadId ? { uploadId: row.uploadId } : {}),
    ...(row.artifactId ? { artifactId: row.artifactId } : {}),
    ...(row.versionId ? { versionId: row.versionId } : {}),
  };
}

async function removeObjectThenRows(
  env: Env,
  row: CleanupRow,
  category: CleanupCategory,
  result: CleanupResult,
  removeRows: () => Promise<void>,
): Promise<void> {
  const summary = result[category];
  summary.attempted += 1;
  const startedAt = Date.now();
  try {
    // R2 deletion is idempotent: a missing object is a successful cleanup.
    await deleteKeys(env, [row.r2Key]);
    await removeRows();
    summary.deleted += 1;
    summary.bytes += row.byteSize;
    const event = {
      operation: category,
      ...eventIds(row),
      count: 1,
      bytes: row.byteSize,
      durationMs: Date.now() - startedAt,
      outcome: "deleted",
    };
    recordArtifactEvent(event);
    writeArtifactMetric(env, event);
  } catch (error) {
    summary.failed += 1;
    const event = {
      operation: category,
      ...eventIds(row),
      count: 1,
      bytes: row.byteSize,
      durationMs: Date.now() - startedAt,
      outcome: "failed",
      errorCode: errorCode(error),
    };
    recordArtifactEvent(event);
    writeArtifactMetric(env, event);
  }
}

function recordD1Deletion(
  env: Env,
  category: CleanupCategory,
  result: CleanupResult,
  ids: Pick<CleanupRow, "uploadId" | "artifactId" | "versionId">,
): void {
  result[category].attempted += 1;
  result[category].deleted += 1;
  const event = { operation: category, ...eventIds({ ...ids, r2Key: "", byteSize: 0 }), count: 1, bytes: 0, outcome: "deleted" };
  recordArtifactEvent(event);
  writeArtifactMetric(env, event);
}

async function cleanExpiredUploads(env: Env, now: number, limit: number, result: CleanupResult): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT r2_key AS r2Key, byte_size AS byteSize, upload_id AS uploadId, NULL AS artifactId, NULL AS versionId
     FROM (
       SELECT f.r2_key, f.byte_size, f.upload_id
       FROM artifact_upload_files f
       INNER JOIN artifact_uploads u ON u.id = f.upload_id
       WHERE (u.expires_at <= ? AND u.status IN ('pending', 'finalizing', 'failed', 'aborted')) OR u.status = 'cleaning'
       UNION
       SELECT l.r2_key, l.byte_size, l.upload_id
       FROM artifact_object_leases l
       INNER JOIN artifact_uploads u ON u.id = l.upload_id
       WHERE ((u.expires_at <= ? AND u.status IN ('pending', 'finalizing', 'failed', 'aborted')) OR u.status = 'cleaning')
         AND NOT EXISTS (SELECT 1 FROM artifact_upload_files f WHERE f.r2_key = l.r2_key)
     )
     ORDER BY r2_key
     LIMIT ?`,
  ).bind(now, now, limit).all<CleanupRow>();

  for (const row of rows.results) {
    if (!row.uploadId || !await reserveExpiredUpload(env, row.uploadId, now)) continue;
    await removeObjectThenRows(env, row, "expired_upload", result, async () => {
      await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM artifact_upload_files
           WHERE r2_key = ? AND upload_id = ?
             AND EXISTS (SELECT 1 FROM artifact_uploads u WHERE u.id = ? AND u.status = 'cleaning')`,
        ).bind(row.r2Key, row.uploadId, row.uploadId),
        env.DB.prepare(
          `DELETE FROM artifact_object_leases
           WHERE r2_key = ? AND upload_id = ?
             AND EXISTS (SELECT 1 FROM artifact_uploads u WHERE u.id = ? AND u.status = 'cleaning')`,
        ).bind(row.r2Key, row.uploadId, row.uploadId),
      ]);
    });
  }

  const remaining = limit - rows.results.length;
  if (remaining === 0) return;
  const exhausted = await env.DB.prepare(
    `SELECT id FROM artifact_uploads u
     WHERE ((expires_at <= ? AND status IN ('pending', 'finalizing', 'failed', 'aborted')) OR status = 'cleaning')
       AND NOT EXISTS (SELECT 1 FROM artifact_upload_files f WHERE f.upload_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM artifact_object_leases l WHERE l.upload_id = u.id)
     ORDER BY expires_at, id
     LIMIT ?`,
  ).bind(now, remaining).all<{ id: string }>();
  for (const upload of exhausted.results) {
    const deleted = await env.DB.prepare(
      `DELETE FROM artifact_uploads
       WHERE id = ? AND status = 'cleaning'
         AND NOT EXISTS (SELECT 1 FROM artifact_upload_files f WHERE f.upload_id = artifact_uploads.id)
         AND NOT EXISTS (SELECT 1 FROM artifact_object_leases l WHERE l.upload_id = artifact_uploads.id)`,
    ).bind(upload.id).run();
    if (deleted.meta.changes === 1) {
      recordD1Deletion(env, "expired_upload", result, { uploadId: upload.id, artifactId: null, versionId: null });
    }
  }
}

/** Atomically makes an expired upload unavailable before deleting its R2 data. */
async function reserveExpiredUpload(env: Env, uploadId: string, now: number): Promise<boolean> {
  const reserved = await env.DB.prepare(
    `UPDATE artifact_uploads SET status = 'cleaning', updated_at = ?
     WHERE id = ? AND expires_at <= ? AND status IN ('pending', 'finalizing', 'failed', 'aborted')`,
  ).bind(now, uploadId, now).run();
  if (reserved.meta.changes === 1) return true;
  const existing = await env.DB.prepare(
    "SELECT id FROM artifact_uploads WHERE id = ? AND status = 'cleaning' LIMIT 1",
  ).bind(uploadId).first();
  return existing !== null;
}

async function cleanStandaloneLeases(env: Env, now: number, limit: number, result: CleanupResult): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT l.r2_key AS r2Key, l.byte_size AS byteSize, l.upload_id AS uploadId, NULL AS artifactId, NULL AS versionId
     FROM artifact_object_leases l
     WHERE l.expires_at <= ?
       AND NOT EXISTS (SELECT 1 FROM artifact_files af WHERE af.r2_key = l.r2_key)
       AND NOT EXISTS (SELECT 1 FROM artifact_upload_files uf WHERE uf.r2_key = l.r2_key)
     ORDER BY l.expires_at, l.r2_key
     LIMIT ?`,
  ).bind(now, limit).all<CleanupRow>();

  for (const row of rows.results) {
    await removeObjectThenRows(env, row, "expired_lease", result, async () => {
      await env.DB.prepare(
        `DELETE FROM artifact_object_leases
         WHERE r2_key = ? AND expires_at <= ?
           AND NOT EXISTS (SELECT 1 FROM artifact_files af WHERE af.r2_key = artifact_object_leases.r2_key)
           AND NOT EXISTS (SELECT 1 FROM artifact_upload_files uf WHERE uf.r2_key = artifact_object_leases.r2_key)`,
      ).bind(row.r2Key, now).run();
    });
  }
}

async function cleanSoftDeletedArtifacts(env: Env, now: number, limit: number, result: CleanupResult): Promise<void> {
  const cutoff = now - ARTIFACT_LIMITS.recoveryMs;
  const rows = await env.DB.prepare(
    `SELECT f.r2_key AS r2Key, f.byte_size AS byteSize, NULL AS uploadId, a.id AS artifactId, v.id AS versionId
     FROM artifact_files f
     INNER JOIN artifact_versions v ON v.id = f.version_id
     INNER JOIN artifacts a ON a.id = v.artifact_id
     WHERE (a.deleted_at IS NOT NULL AND a.deleted_at <= ? AND a.cleanup_started_at IS NULL)
        OR a.cleanup_started_at IS NOT NULL
     ORDER BY a.deleted_at, f.r2_key
     LIMIT ?`,
  ).bind(cutoff, limit).all<CleanupRow>();

  for (const row of rows.results) {
    if (!row.artifactId || !await reserveSoftDeletedArtifact(env, row.artifactId, cutoff, now)) continue;
    await removeObjectThenRows(env, row, "expired_artifact", result, async () => {
      await env.DB.prepare(
        `DELETE FROM artifact_files
         WHERE r2_key = ?
           AND EXISTS (
             SELECT 1 FROM artifact_versions v
             INNER JOIN artifacts a ON a.id = v.artifact_id
             WHERE v.id = artifact_files.version_id AND a.cleanup_started_at IS NOT NULL
           )`,
      ).bind(row.r2Key).run();
    });
  }

  const remaining = limit - rows.results.length;
  if (remaining === 0) return;
  const emptyArtifacts = await env.DB.prepare(
    `SELECT a.id
     FROM artifacts a
     WHERE a.cleanup_started_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM artifact_versions v
         INNER JOIN artifact_files f ON f.version_id = v.id
         WHERE v.artifact_id = a.id
       )
     ORDER BY a.deleted_at, a.id
     LIMIT ?`,
  ).bind(remaining).all<{ id: string }>();
  for (const artifact of emptyArtifacts.results) {
    const deleted = await env.DB.batch([
      env.DB.prepare("DELETE FROM artifact_uploads WHERE artifact_id = ? AND status = 'complete'").bind(artifact.id),
      env.DB.prepare(
        `DELETE FROM artifacts
         WHERE id = ? AND cleanup_started_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM artifact_versions v
             INNER JOIN artifact_files f ON f.version_id = v.id
             WHERE v.artifact_id = artifacts.id
           )`,
      ).bind(artifact.id),
    ]);
    if (deleted[1].meta.changes === 1) {
      recordD1Deletion(env, "expired_artifact", result, { uploadId: null, artifactId: artifact.id, versionId: null });
    }
  }
}

/** Atomically removes an artifact from the recovery path before deleting R2 data. */
async function reserveSoftDeletedArtifact(env: Env, artifactId: string, cutoff: number, now: number): Promise<boolean> {
  const reserved = await env.DB.prepare(
    `UPDATE artifacts SET cleanup_started_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at <= ? AND cleanup_started_at IS NULL`,
  ).bind(now, now, artifactId, cutoff).run();
  if (reserved.meta.changes === 1) return true;
  const existing = await env.DB.prepare(
    "SELECT id FROM artifacts WHERE id = ? AND cleanup_started_at IS NOT NULL LIMIT 1",
  ).bind(artifactId).first();
  return existing !== null;
}

/** Reclaims only expired, unreferenced artifact storage. Every category is capped at 100 records. */
export async function cleanupArtifacts(env: Env, now: number, batchSize = 100): Promise<CleanupResult> {
  const result = emptyResult();
  const limit = boundedBatchSize(batchSize);
  await cleanExpiredUploads(env, now, limit, result);
  await cleanStandaloneLeases(env, now, limit, result);
  await cleanSoftDeletedArtifacts(env, now, limit, result);
  return result;
}
