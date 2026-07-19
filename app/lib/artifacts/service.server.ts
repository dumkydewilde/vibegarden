import {
  ARTIFACT_LIMITS,
  ArtifactError,
  type ArtifactManifestFile,
  type ArtifactPackageSource,
  type ArtifactType,
} from "./contracts";
import { artifactObjectKey, deleteKeys, putLeasedObject } from "./object-store.server";
import {
  finalizeExistingArtifactVersion,
  finalizeNewArtifact,
  findOwnedArtifact,
  findOwnedRecoverableArtifact,
  findOwnedIdempotency,
  findOwnedProject,
  findOwnedUpload,
  findOwnedVersion,
  findGalleryArtifact,
  markOwnedUploadAborted,
} from "./repository.server";
import type {
  ArtifactDetailPresentation,
  ArtifactFile,
  GalleryArtifactDetailPresentation,
  GalleryArtifactPresentation,
  ArtifactPresentation,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
} from "./presenters.server";
import {
  HTML_PACKAGE_MIME_BY_EXTENSION,
  SAFE_DOWNLOAD_MIME_BY_EXTENSION,
  inspectArtifactContent,
  mutationFingerprint,
  normalizeArtifactLink,
  normalizeArtifactOrigins,
  normalizeArtifactPath,
  validateArtifactPackage,
} from "./validation";

type ProjectSelection =
  | { projectId: string }
  | { projectDraft: { title: string; oneLiner?: string } };

type UploadBaseInput = {
  project: ProjectSelection;
  type: Exclude<ArtifactType, "link">;
  title: string;
  description?: string;
  allowedDataOrigins?: string[];
  idempotencyKey: string;
  /** Existing-artifact uploads are versions; project and type come from D1. */
  artifactId?: string;
};

type UploadFileInput = {
  path: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
};

type LinkBaseInput = {
  project: ProjectSelection;
  title: string;
  description?: string;
  url: string;
  allowedDataOrigins?: string[];
  idempotencyKey: string;
};

export type UploadSessionResult = {
  uploadId: string;
  artifactId: string;
  versionId: string;
  expiresAt: number;
  completed: UploadedFileResult[];
};

export type UploadedFileResult = {
  path: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
};

export type ArtifactMutationResult = { artifactId: string; versionId: string };

export type ArtifactRead = ArtifactPresentation & { version: ArtifactVersionDetail };
export type RecoverableArtifactRead = ArtifactRead & { deletedAt: number | null };
export type RecoverableArtifactPresentation = ArtifactPresentation & { deletedAt: number | null };
export type GalleryArtifactRead = GalleryArtifactDetailPresentation;

type StoredUpload = {
  id: string;
  artifact_id: string;
  version_id: string;
  project_id: string | null;
  project_draft_title: string | null;
  project_draft_one_liner: string | null;
  type: Exclude<ArtifactType, "link">;
  title: string;
  description: string | null;
  allowed_data_origins: string;
  source: "web" | "mcp";
  status: "pending" | "finalizing" | "complete" | "failed" | "aborted";
  expires_at: number;
};

type StoredFile = ArtifactManifestFile & { r2_key: string };

const SHA256 = /^[a-f0-9]{64}$/u;
const encoder = new TextEncoder();
const browserExtendedMime = new Set([
  "application/json",
  "application/vnd.apache.parquet",
  "text/csv",
  "text/tab-separated-values",
]);

function artifactError(code: ConstructorParameters<typeof ArtifactError>[0]): never {
  throw new ArtifactError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertFields(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !fields.includes(key))) artifactError("invalid_input");
}

function stringField(value: unknown, max: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || Array.from(value).length > max) artifactError("invalid_input");
  return value;
}

function idempotencyKey(value: unknown): string {
  const key = stringField(value, 256)!;
  if (!key) artifactError("invalid_input");
  return key;
}

function parseProjectSelection(value: unknown, allowDraft: boolean): ProjectSelection {
  assertFields(value, ["projectId", "projectDraft"]);
  if (typeof value.projectId === "string" && value.projectDraft === undefined && value.projectId) {
    return { projectId: value.projectId };
  }
  if (!allowDraft || value.projectId !== undefined) artifactError("invalid_input");
  assertFields(value.projectDraft, ["title", "oneLiner"]);
  const title = stringField(value.projectDraft.title, ARTIFACT_LIMITS.titleChars)!;
  const oneLiner = stringField(value.projectDraft.oneLiner, 300, false);
  if (!title) artifactError("invalid_input");
  return { projectDraft: { title, ...(oneLiner === undefined ? {} : { oneLiner }) } };
}

function parseUploadInput(value: unknown, allowDraft: boolean): UploadBaseInput {
  assertFields(value, ["project", "type", "title", "description", "allowedDataOrigins", "idempotencyKey", "artifactId"]);
  const type = value.type;
  if (type !== "html" && type !== "file") artifactError("invalid_input");
  const title = stringField(value.title, ARTIFACT_LIMITS.titleChars)!;
  if (!title) artifactError("invalid_input");
  const description = stringField(value.description, ARTIFACT_LIMITS.descriptionChars, false);
  const allowedDataOrigins = value.allowedDataOrigins === undefined
    ? undefined
    : normalizeArtifactOrigins(value.allowedDataOrigins as string[]);
  const artifactId = value.artifactId === undefined ? undefined : stringField(value.artifactId, 200)!;
  if (artifactId !== undefined && !artifactId) artifactError("invalid_input");
  return {
    project: parseProjectSelection(value.project, allowDraft),
    type,
    title,
    ...(description === undefined ? {} : { description }),
    ...(allowedDataOrigins === undefined ? {} : { allowedDataOrigins }),
    idempotencyKey: idempotencyKey(value.idempotencyKey),
    ...(artifactId === undefined ? {} : { artifactId }),
  };
}

function parseLinkInput(value: unknown, allowDraft: boolean): LinkBaseInput {
  assertFields(value, ["project", "title", "description", "url", "allowedDataOrigins", "idempotencyKey"]);
  const title = stringField(value.title, ARTIFACT_LIMITS.titleChars)!;
  if (!title) artifactError("invalid_input");
  const description = stringField(value.description, ARTIFACT_LIMITS.descriptionChars, false);
  const allowedDataOrigins = value.allowedDataOrigins === undefined
    ? undefined
    : normalizeArtifactOrigins(value.allowedDataOrigins as string[]);
  return {
    project: parseProjectSelection(value.project, allowDraft),
    title,
    ...(description === undefined ? {} : { description }),
    url: normalizeArtifactLink(stringField(value.url, 8_192)!),
    ...(allowedDataOrigins === undefined ? {} : { allowedDataOrigins }),
    idempotencyKey: idempotencyKey(value.idempotencyKey),
  };
}

function databaseIdempotencyKey(operation: string, targetKey: string, key: string): string {
  return `${operation}:${targetKey}:${key}`;
}

function projectTarget(project: ProjectSelection): string {
  return "projectId" in project ? `project:${project.projectId}` : "project:draft";
}

async function uploadResult(
  env: Env,
  row: Pick<StoredUpload, "id" | "artifact_id" | "version_id" | "expires_at">,
): Promise<UploadSessionResult> {
  const files = await env.DB.prepare(
    "SELECT path, mime_type AS mimeType, byte_size AS byteSize, sha256 FROM artifact_upload_files WHERE upload_id = ? ORDER BY path",
  ).bind(row.id).all<UploadedFileResult>();
  return {
    uploadId: row.id,
    artifactId: row.artifact_id,
    versionId: row.version_id,
    expiresAt: row.expires_at,
    completed: files.results,
  };
}

function sourceFor(source: ArtifactPackageSource): "web" | "mcp" {
  return source === "browser" ? "web" : "mcp";
}

function now(): number {
  return Date.now();
}

function parseOrigins(value: string): string[] {
  try {
    const origins = JSON.parse(value);
    return Array.isArray(origins) && origins.every((origin) => typeof origin === "string") ? origins : [];
  } catch {
    return [];
  }
}

function trimAndCap(value: string, limit: number): string {
  return Array.from(value.trim()).slice(0, limit).join("");
}

function fingerprintInput(input: {
  title: string;
  description?: string;
  allowedDataOrigins?: string[];
  files?: UploadFileInput[];
}): Record<string, unknown> {
  return {
    title: input.title,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.allowedDataOrigins === undefined ? {} : { allowedDataOrigins: input.allowedDataOrigins }),
    ...(input.files === undefined ? {} : { files: input.files }),
  };
}

async function requireIdempotency(
  env: Env,
  userId: string,
  operation: string,
  targetKey: string,
  key: string,
  fingerprint: string,
): Promise<ArtifactMutationResult | null> {
  const existing = await findOwnedIdempotency(env, userId, operation, targetKey, key) as {
    fingerprint: string;
    artifact_id: string;
    version_id: string;
  } | null;
  if (!existing) return null;
  if (existing.fingerprint !== fingerprint) artifactError("idempotency_conflict");
  return { artifactId: existing.artifact_id, versionId: existing.version_id };
}

async function linkFingerprint(input: { title?: string; description?: string; allowedDataOrigins: string[]; url: string }): Promise<string> {
  const metadata = await mutationFingerprint({
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined ? {} : { description: input.description }),
    allowedDataOrigins: input.allowedDataOrigins,
  });
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${metadata}\n${input.url}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertOwnedProjectSelection(env: Env, userId: string, project: ProjectSelection): Promise<void> {
  if ("projectId" in project && !await findOwnedProject(env, userId, project.projectId)) artifactError("not_found");
}

async function createUploadSessionInternal(
  env: Env,
  userId: string,
  rawInput: unknown,
  source: ArtifactPackageSource,
  fingerprintFiles?: UploadFileInput[],
): Promise<UploadSessionResult> {
  const input = parseUploadInput(rawInput, source === "browser");
  if (source === "mcp" && "projectDraft" in input.project) artifactError("invalid_input");
  await assertOwnedProjectSelection(env, userId, input.project);

  let targetKey = projectTarget(input.project);
  let type = input.type;
  let project = input.project;
  if (input.artifactId) {
    const artifact = await findOwnedArtifact(env, userId, input.artifactId);
    if (!artifact) artifactError("not_found");
    if (artifact.type === "link" || input.type !== artifact.type || !("projectId" in input.project) || input.project.projectId !== artifact.project_id) {
      artifactError("invalid_input");
    }
    targetKey = `artifact:${artifact.id}`;
    type = artifact.type;
    project = { projectId: artifact.project_id };
  }

  const operation = input.artifactId ? "create_version" : "create_artifact";
  const fingerprint = await mutationFingerprint(fingerprintInput({ ...input, files: fingerprintFiles }));
  const replay = await requireIdempotency(env, userId, operation, targetKey, input.idempotencyKey, fingerprint);
  if (replay) {
    const upload = await env.DB.prepare(
      "SELECT id, artifact_id, version_id, expires_at FROM artifact_uploads WHERE artifact_id = ? AND version_id = ? AND user_id = ? LIMIT 1",
    ).bind(replay.artifactId, replay.versionId, userId).first<Pick<StoredUpload, "id" | "artifact_id" | "version_id" | "expires_at">>();
    if (!upload) artifactError("state_conflict");
    return uploadResult(env, upload);
  }

  const timestamp = now();
  const row = {
    id: crypto.randomUUID(),
    artifactId: input.artifactId ?? crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    projectId: "projectId" in project ? project.projectId : null,
    projectDraftTitle: "projectDraft" in project ? project.projectDraft.title : null,
    projectDraftOneLiner: "projectDraft" in project ? project.projectDraft.oneLiner ?? null : null,
    type,
    title: input.title,
    description: input.description ?? null,
    allowedDataOrigins: JSON.stringify(input.allowedDataOrigins ?? []),
    source: sourceFor(source),
    expiresAt: timestamp + ARTIFACT_LIMITS.uploadTtlMs,
  };

  try {
    const writes = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO artifact_uploads
         (id, user_id, artifact_id, version_id, project_id, project_draft_title, project_draft_one_liner, type, title, description, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      ).bind(row.id, userId, row.artifactId, row.versionId, row.projectId, row.projectDraftTitle, row.projectDraftOneLiner, row.type, row.title, row.description, row.allowedDataOrigins, row.source, databaseIdempotencyKey(operation, targetKey, input.idempotencyKey), row.expiresAt, timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO artifact_idempotency (user_id, operation, target_key, idempotency_key, fingerprint, artifact_id, version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(userId, operation, targetKey, input.idempotencyKey, fingerprint, row.artifactId, row.versionId, timestamp),
    ]);
    if (writes.some((result) => result.meta.changes !== 1)) artifactError("state_conflict");
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    // A concurrent winner may have committed the same scope; resolve it without leaking database details.
    const concurrent = await requireIdempotency(env, userId, operation, targetKey, input.idempotencyKey, fingerprint);
    if (concurrent) {
      const upload = await env.DB.prepare(
        "SELECT id, artifact_id, version_id, expires_at FROM artifact_uploads WHERE artifact_id = ? AND version_id = ? AND user_id = ? LIMIT 1",
      ).bind(concurrent.artifactId, concurrent.versionId, userId).first<Pick<StoredUpload, "id" | "artifact_id" | "version_id" | "expires_at">>();
      if (upload) return uploadResult(env, upload);
    }
    throw new ArtifactError("internal");
  }
  return { uploadId: row.id, artifactId: row.artifactId, versionId: row.versionId, expiresAt: row.expiresAt, completed: [] };
}

/** Starts a browser upload. R2 object keys, artifact IDs, and source are always server composed. */
export async function createUploadSession(env: Env, userId: string, input: UploadBaseInput): Promise<UploadSessionResult> {
  return createUploadSessionInternal(env, userId, input, "browser");
}

function parseUploadFile(value: unknown): UploadFileInput {
  assertFields(value, ["path", "mimeType", "byteSize", "sha256"]);
  const path = normalizeArtifactPath(stringField(value.path, ARTIFACT_LIMITS.pathBytes)!);
  const mimeType = stringField(value.mimeType, 128)!;
  const byteSize = value.byteSize;
  const sha256 = stringField(value.sha256, 64)!;
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || !SHA256.test(sha256)) artifactError("invalid_input");
  // canonical package validation applies the path-to-MIME map without reading caller content.
  try {
    validateArtifactPackage({ type: path === "index.html" ? "html" : "file", source: "browser", files: [{ path, mimeType, byteSize, sha256 }] });
  } catch (error) {
    if (error instanceof ArtifactError && error.code === "invalid_manifest" && path !== "index.html") {
      // A non-entry HTML dependency is valid too; canonical manifest checking below handles it.
      const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
      if (HTML_PACKAGE_MIME_BY_EXTENSION[extension as keyof typeof HTML_PACKAGE_MIME_BY_EXTENSION] === mimeType || SAFE_DOWNLOAD_MIME_BY_EXTENSION[extension as keyof typeof SAFE_DOWNLOAD_MIME_BY_EXTENSION] === mimeType) {
        return { path, mimeType, byteSize, sha256: sha256.toLowerCase() };
      }
    }
    throw error;
  }
  return { path, mimeType, byteSize, sha256: sha256.toLowerCase() };
}

function isBrowserExtended(file: UploadFileInput): boolean {
  return browserExtendedMime.has(file.mimeType) || file.mimeType.startsWith("audio/") || file.mimeType.startsWith("video/");
}

async function reserveFileLease(env: Env, userId: string, upload: StoredUpload, file: UploadFileInput, r2Key: string): Promise<"reserved" | "complete" | "recover"> {
  const source = upload.source === "mcp" ? "mcp" : "browser";
  const maxFiles = source === "mcp" ? ARTIFACT_LIMITS.mcpFiles : ARTIFACT_LIMITS.browserFiles;
  const maxBytes = source === "mcp" ? ARTIFACT_LIMITS.mcpBytes : ARTIFACT_LIMITS.browserBytes;
  if (source === "browser" && file.byteSize > ARTIFACT_LIMITS.ordinaryFileBytes && !isBrowserExtended(file)) artifactError("limit_exceeded");
  const timestamp = now();
  const existing = await env.DB.prepare(
    "SELECT path, mime_type, byte_size, sha256 FROM artifact_upload_files WHERE upload_id = ? AND path = ? LIMIT 1",
  ).bind(upload.id, file.path).first<{ path: string; mime_type: string; byte_size: number; sha256: string }>();
  if (existing) {
    if (existing.mime_type === file.mimeType && existing.byte_size === file.byteSize && existing.sha256 === file.sha256) return "complete";
    artifactError("idempotency_conflict");
  }

  const result = await env.DB.prepare(
    `INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM artifact_upload_files WHERE upload_id = ? AND path = ?)
       AND NOT EXISTS (SELECT 1 FROM artifact_object_leases WHERE r2_key = ?)
       AND (SELECT COUNT(*) FROM artifact_upload_files WHERE upload_id = ?) +
           (SELECT COUNT(*) FROM artifact_object_leases l WHERE l.upload_id = ? AND NOT EXISTS (SELECT 1 FROM artifact_upload_files f WHERE f.r2_key = l.r2_key)) < ?
       AND (SELECT COALESCE(SUM(byte_size), 0) FROM artifact_upload_files WHERE upload_id = ?) +
           (SELECT COALESCE(SUM(l.byte_size), 0) FROM artifact_object_leases l WHERE l.upload_id = ? AND NOT EXISTS (SELECT 1 FROM artifact_upload_files f WHERE f.r2_key = l.r2_key)) + ? <= ?`,
  ).bind(r2Key, upload.id, userId, file.byteSize, file.sha256, upload.expires_at, timestamp, upload.id, file.path, r2Key, upload.id, upload.id, maxFiles, upload.id, upload.id, file.byteSize, maxBytes).run();
  if (result.meta.changes === 1) return "reserved";

  const after = await env.DB.prepare(
    "SELECT mime_type, byte_size, sha256 FROM artifact_upload_files WHERE upload_id = ? AND path = ? LIMIT 1",
  ).bind(upload.id, file.path).first<{ mime_type: string; byte_size: number; sha256: string }>();
  if (after && after.mime_type === file.mimeType && after.byte_size === file.byteSize && after.sha256 === file.sha256) return "complete";
  const lease = await env.DB.prepare(
    "SELECT byte_size, sha256 FROM artifact_object_leases WHERE r2_key = ? AND upload_id = ? AND user_id = ? LIMIT 1",
  ).bind(r2Key, upload.id, userId).first<{ byte_size: number; sha256: string }>();
  if (lease && (lease.byte_size !== file.byteSize || lease.sha256 !== file.sha256)) artifactError("idempotency_conflict");
  if (lease) return "recover";
  artifactError("limit_exceeded");
}

function checksumHex(value: ArrayBuffer | undefined): string | undefined {
  if (!value) return undefined;
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateRecoveryBody(body: ReadableStream | ArrayBuffer | string, file: UploadFileInput): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = typeof body === "string"
      ? encoder.encode(body)
      : body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : new Uint8Array(await new Response(body).arrayBuffer());
  } catch {
    artifactError("invalid_manifest");
  }
  if (bytes.byteLength !== file.byteSize) artifactError("invalid_manifest");
  const actualSha256 = checksumHex(await crypto.subtle.digest("SHA-256", bytes));
  if (actualSha256 !== file.sha256) artifactError("invalid_checksum");
}

async function inspectStoredObject(env: Env, r2Key: string, file: UploadFileInput): Promise<{ byteSize: number; sha256: string }> {
  let object: R2ObjectBody | null;
  try {
    object = await env.ARTIFACTS.get(r2Key);
  } catch {
    artifactError("storage_unavailable");
  }
  if (!object) artifactError("storage_unavailable");
  const actualSha256 = checksumHex(object.checksums.sha256);
  if (object.size !== file.byteSize || actualSha256 !== file.sha256) artifactError("invalid_manifest");
  try {
    inspectArtifactContent({ path: file.path, mimeType: file.mimeType, content: new Uint8Array(await object.arrayBuffer()) });
  } catch (error) {
    try {
      await deleteKeys(env, [r2Key]);
    } catch {
      // The lease remains for recovery if deletion itself is unavailable.
    }
    throw error;
  }
  return { byteSize: object.size, sha256: actualSha256 };
}

/** Writes one leased file, verifies its checksum in R2, inspects it, then records the D1 manifest row. */
export async function putUploadFile(
  env: Env,
  userId: string,
  uploadId: string,
  input: UploadFileInput,
  body: ReadableStream | ArrayBuffer | string,
): Promise<UploadedFileResult> {
  const file = parseUploadFile(input);
  const upload = await findOwnedUpload(env, userId, uploadId) as StoredUpload | null;
  if (!upload) artifactError("not_found");
  if (upload.status !== "pending" || upload.expires_at <= now()) artifactError("state_conflict");
  const r2Key = artifactObjectKey(upload.artifact_id, upload.version_id, file.path);
  const reservation = await reserveFileLease(env, userId, upload, file, r2Key);
  if (reservation === "complete") return file;

  let stored: { byteSize: number; sha256: string };
  if (reservation === "reserved") {
    stored = await putLeasedObject(env, { r2Key, body, mimeType: file.mimeType, sha256: file.sha256 });
  } else {
    await validateRecoveryBody(body, file);
    stored = await inspectStoredObject(env, r2Key, file);
  }
  if (stored.byteSize !== file.byteSize || stored.sha256 !== file.sha256) artifactError("invalid_manifest");
  const inspected = await inspectStoredObject(env, r2Key, file);
  try {
    const result = await env.DB.prepare(
      `INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM artifact_object_leases WHERE r2_key = ? AND upload_id = ? AND user_id = ? AND byte_size = ? AND sha256 = ? AND expires_at > ?)
         AND NOT EXISTS (SELECT 1 FROM artifact_upload_files WHERE upload_id = ? AND path = ?)`,
    ).bind(upload.id, file.path, r2Key, file.mimeType, inspected.byteSize, inspected.sha256, now(), r2Key, upload.id, userId, inspected.byteSize, inspected.sha256, now(), upload.id, file.path).run();
    if (result.meta.changes !== 1) artifactError("state_conflict");
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    // The object deliberately remains leased until cleanup can reclaim it.
    throw new ArtifactError("internal");
  }
  return { ...file, byteSize: inspected.byteSize, sha256: inspected.sha256 };
}

async function markFailed(env: Env, userId: string, uploadId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE artifact_uploads SET status = 'failed', updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('pending', 'finalizing')",
  ).bind(now(), uploadId, userId).run();
}

function artifactFiles(input: StoredFile[]): ArtifactManifestFile[] {
  return input.map(({ path, mimeType, byteSize, sha256 }) => ({ path, mimeType, byteSize, sha256 }));
}

async function assertRecordedFilesLeased(
  env: Env,
  userId: string,
  upload: StoredUpload,
  files: StoredFile[],
): Promise<void> {
  const leases = await env.DB.prepare(
    "SELECT r2_key, byte_size, sha256, expires_at FROM artifact_object_leases WHERE upload_id = ? AND user_id = ?",
  ).bind(upload.id, userId).all<{ r2_key: string; byte_size: number; sha256: string; expires_at: number }>();
  const byKey = new Map(leases.results.map((lease) => [lease.r2_key, lease]));
  for (const file of files) {
    const key = artifactObjectKey(upload.artifact_id, upload.version_id, file.path);
    const lease = byKey.get(key);
    if (file.r2_key !== key || !lease || lease.byte_size !== file.byteSize || lease.sha256 !== file.sha256 || lease.expires_at <= now()) {
      artifactError("invalid_manifest");
    }
  }
}

async function finalizeDraftArtifact(env: Env, userId: string, upload: StoredUpload, timestamp: number, expectedFileCount: number): Promise<void> {
  const projectId = crypto.randomUUID();
  try {
    const writes = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO projects (id, user_id, title, one_liner, modules, status, created_at, updated_at)
         SELECT ?, u.user_id, u.project_draft_title, u.project_draft_one_liner, '[]', 'seed', ?, ?
         FROM artifact_uploads u WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing' AND u.project_id IS NULL`,
      ).bind(projectId, timestamp, timestamp, upload.id, userId),
      env.DB.prepare(
        `INSERT INTO artifacts (id, user_id, project_id, type, title, description, visibility, current_version_id, created_at, updated_at)
         SELECT u.artifact_id, u.user_id, ?, u.type, u.title, u.description, 'private', NULL, ?, ?
         FROM artifact_uploads u WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing'
           AND EXISTS (SELECT 1 FROM artifact_upload_files f WHERE f.upload_id = u.id)`,
      ).bind(projectId, timestamp, timestamp, upload.id, userId),
      env.DB.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at)
         SELECT u.version_id, u.artifact_id, 1, u.source, CASE WHEN u.type = 'html' THEN 'index.html' ELSE NULL END, NULL,
           u.allowed_data_origins, COUNT(f.r2_key), COALESCE(SUM(f.byte_size), 0), u.user_id, ?
         FROM artifact_uploads u INNER JOIN artifact_upload_files f ON f.upload_id = u.id
         WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing' GROUP BY u.id`,
      ).bind(timestamp, upload.id, userId),
      env.DB.prepare(
        `INSERT INTO artifact_files (version_id, path, r2_key, mime_type, byte_size, sha256, created_at)
         SELECT u.version_id, f.path, f.r2_key, f.mime_type, f.byte_size, f.sha256, ?
         FROM artifact_uploads u INNER JOIN artifact_upload_files f ON f.upload_id = u.id
         WHERE u.id = ? AND u.user_id = ? AND u.status = 'finalizing'`,
      ).bind(timestamp, upload.id, userId),
      env.DB.prepare("UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(upload.version_id, timestamp, upload.artifact_id, userId),
      env.DB.prepare("UPDATE artifact_uploads SET status = 'complete', project_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'finalizing'").bind(projectId, timestamp, upload.id, userId),
      env.DB.prepare(
        `DELETE FROM artifact_object_leases
         WHERE upload_id = ? AND user_id = ?
           AND EXISTS (
             SELECT 1 FROM artifact_upload_files f
             WHERE f.upload_id = artifact_object_leases.upload_id AND f.r2_key = artifact_object_leases.r2_key
           )`,
      ).bind(upload.id, userId),
    ]);
    if (writes[0].meta.changes !== 1 || writes[1].meta.changes !== 1 || writes[2].meta.changes !== 1 || writes[3].meta.changes !== expectedFileCount || writes[4].meta.changes !== 1 || writes[5].meta.changes !== 1) artifactError("state_conflict");
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    throw new ArtifactError("internal");
  }
}

/** Finalizes from upload rows only. Failed validation never creates a partial artifact. */
export async function finalizeUpload(env: Env, userId: string, uploadId: string): Promise<ArtifactMutationResult> {
  const upload = await findOwnedUpload(env, userId, uploadId) as StoredUpload | null;
  if (!upload) artifactError("not_found");
  if (upload.status === "complete") return { artifactId: upload.artifact_id, versionId: upload.version_id };
  if (upload.status !== "pending" && upload.status !== "finalizing") artifactError("state_conflict");
  if (upload.expires_at <= now()) {
    await markFailed(env, userId, uploadId);
    artifactError("invalid_manifest");
  }
  if (upload.status === "pending") {
    const transition = await env.DB.prepare(
      "UPDATE artifact_uploads SET status = 'finalizing', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'pending' AND expires_at > ?",
    ).bind(now(), uploadId, userId, now()).run();
    if (transition.meta.changes !== 1) artifactError("state_conflict");
  }
  const files = await env.DB.prepare(
    "SELECT path, mime_type AS mimeType, byte_size AS byteSize, sha256, r2_key FROM artifact_upload_files WHERE upload_id = ? ORDER BY path",
  ).bind(uploadId).all<StoredFile>();
  try {
    validateArtifactPackage({ type: upload.type, source: upload.source === "mcp" ? "mcp" : "browser", files: artifactFiles(files.results) });
    await assertRecordedFilesLeased(env, userId, upload, files.results);
  } catch (error) {
    await markFailed(env, userId, uploadId);
    if (error instanceof ArtifactError) throw error;
    throw new ArtifactError("invalid_manifest");
  }
  try {
    if (upload.project_draft_title !== null) {
      await finalizeDraftArtifact(env, userId, upload, now(), files.results.length);
    } else if (upload.project_id !== null && upload.artifact_id) {
      const existing = await findOwnedArtifact(env, userId, upload.artifact_id);
      if (existing) await finalizeExistingArtifactVersion(env, userId, { uploadId, now: now() });
      else await finalizeNewArtifact(env, userId, { uploadId, now: now() });
    } else {
      artifactError("state_conflict");
    }
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    throw new ArtifactError("internal");
  }
  return { artifactId: upload.artifact_id, versionId: upload.version_id };
}

export async function abortUpload(env: Env, userId: string, uploadId: string): Promise<void> {
  if (!await markOwnedUploadAborted(env, userId, uploadId, now())) artifactError("not_found");
}

async function createLinkWithDraft(
  env: Env,
  userId: string,
  input: LinkBaseInput,
  artifactId: string,
  versionId: string,
  timestamp: number,
  targetKey: string,
  fingerprint: string,
): Promise<void> {
  const projectId = crypto.randomUUID();
  const project = input.project;
  if (!("projectDraft" in project)) artifactError("internal");
  const writes = await env.DB.batch([
    env.DB.prepare("INSERT INTO projects (id, user_id, title, one_liner, modules, status, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', 'seed', ?, ?)").bind(projectId, userId, project.projectDraft.title, project.projectDraft.oneLiner ?? null, timestamp, timestamp),
    env.DB.prepare("INSERT INTO artifacts (id, user_id, project_id, type, title, description, visibility, created_at, updated_at) VALUES (?, ?, ?, 'link', ?, ?, 'private', ?, ?)").bind(artifactId, userId, projectId, input.title, input.description ?? null, timestamp, timestamp),
    env.DB.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at) VALUES (?, ?, 1, 'web', NULL, ?, ?, 0, 0, ?, ?)").bind(versionId, artifactId, input.url, JSON.stringify(input.allowedDataOrigins ?? []), userId, timestamp),
    env.DB.prepare("UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(versionId, timestamp, artifactId, userId),
    env.DB.prepare("INSERT INTO artifact_idempotency (user_id, operation, target_key, idempotency_key, fingerprint, artifact_id, version_id, created_at) VALUES (?, 'create_link', ?, ?, ?, ?, ?, ?)").bind(userId, targetKey, input.idempotencyKey, fingerprint, artifactId, versionId, timestamp),
  ]);
  if (writes.some((result) => result.meta.changes !== 1)) artifactError("state_conflict");
}

async function createLinkWithProject(
  env: Env,
  userId: string,
  input: LinkBaseInput,
  projectId: string,
  artifactId: string,
  versionId: string,
  timestamp: number,
  targetKey: string,
  fingerprint: string,
): Promise<void> {
  const writes = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO artifacts (id, user_id, project_id, type, title, description, visibility, created_at, updated_at)
       SELECT ?, ?, p.id, 'link', ?, ?, 'private', ?, ? FROM projects p WHERE p.id = ? AND p.user_id = ?`,
    ).bind(artifactId, userId, input.title, input.description ?? null, timestamp, timestamp, projectId, userId),
    env.DB.prepare(
      "INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at) SELECT ?, a.id, 1, 'web', NULL, ?, ?, 0, 0, ?, ? FROM artifacts a WHERE a.id = ? AND a.user_id = ? AND a.project_id = ?",
    ).bind(versionId, input.url, JSON.stringify(input.allowedDataOrigins ?? []), userId, timestamp, artifactId, userId, projectId),
    env.DB.prepare("UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(versionId, timestamp, artifactId, userId),
    env.DB.prepare("INSERT INTO artifact_idempotency (user_id, operation, target_key, idempotency_key, fingerprint, artifact_id, version_id, created_at) VALUES (?, 'create_link', ?, ?, ?, ?, ?, ?)").bind(userId, targetKey, input.idempotencyKey, fingerprint, artifactId, versionId, timestamp),
  ]);
  if (writes.some((result) => result.meta.changes !== 1)) artifactError("state_conflict");
}

export async function createLinkArtifact(env: Env, userId: string, rawInput: LinkBaseInput): Promise<ArtifactMutationResult> {
  const input = parseLinkInput(rawInput, true);
  await assertOwnedProjectSelection(env, userId, input.project);
  const targetKey = projectTarget(input.project);
  const fingerprint = await linkFingerprint({ title: input.title, description: input.description, allowedDataOrigins: input.allowedDataOrigins ?? [], url: input.url });
  const replay = await requireIdempotency(env, userId, "create_link", targetKey, input.idempotencyKey, fingerprint);
  if (replay) return replay;
  const artifactId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const timestamp = now();
  try {
    if ("projectDraft" in input.project) {
      await createLinkWithDraft(env, userId, input, artifactId, versionId, timestamp, targetKey, fingerprint);
    } else {
      await createLinkWithProject(env, userId, input, input.project.projectId, artifactId, versionId, timestamp, targetKey, fingerprint);
    }
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    throw new ArtifactError("internal");
  }
  return { artifactId, versionId };
}

export async function createLinkArtifactVersion(env: Env, userId: string, rawInput: unknown): Promise<ArtifactMutationResult> {
  assertFields(rawInput, ["artifactId", "url", "allowedDataOrigins", "idempotencyKey"]);
  const artifactId = stringField(rawInput.artifactId, 200)!;
  const artifact = await findOwnedArtifact(env, userId, artifactId);
  if (!artifact || artifact.type !== "link") artifactError("not_found");
  const url = normalizeArtifactLink(stringField(rawInput.url, 8_192)!);
  const origins = rawInput.allowedDataOrigins === undefined ? [] : normalizeArtifactOrigins(rawInput.allowedDataOrigins as string[]);
  const key = idempotencyKey(rawInput.idempotencyKey);
  const fingerprint = await linkFingerprint({ allowedDataOrigins: origins, url });
  const targetKey = `artifact:${artifactId}`;
  const replay = await requireIdempotency(env, userId, "create_link_version", targetKey, key, fingerprint);
  if (replay) return replay;
  const versionId = crypto.randomUUID();
  const timestamp = now();
  try {
    const writes = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_by, created_at)
         SELECT ?, a.id, COALESCE((SELECT MAX(version_number) FROM artifact_versions WHERE artifact_id = a.id), 0) + 1, 'web', NULL, ?, ?, 0, 0, ?, ?
         FROM artifacts a WHERE a.id = ? AND a.user_id = ? AND a.type = 'link' AND a.deleted_at IS NULL`,
      ).bind(versionId, url, JSON.stringify(origins), userId, timestamp, artifactId, userId),
      env.DB.prepare("UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(versionId, timestamp, artifactId, userId),
      env.DB.prepare("INSERT INTO artifact_idempotency (user_id, operation, target_key, idempotency_key, fingerprint, artifact_id, version_id, created_at) VALUES (?, 'create_link_version', ?, ?, ?, ?, ?, ?)").bind(userId, targetKey, key, fingerprint, artifactId, versionId, timestamp),
    ]);
    if (writes.some((result) => result.meta.changes !== 1)) artifactError("state_conflict");
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    throw new ArtifactError("internal");
  }
  return { artifactId, versionId };
}

function inferredMime(type: Exclude<ArtifactType, "link">, path: string): string {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  const mime = (type === "html" ? HTML_PACKAGE_MIME_BY_EXTENSION : SAFE_DOWNLOAD_MIME_BY_EXTENSION)[extension as keyof typeof HTML_PACKAGE_MIME_BY_EXTENSION];
  if (!mime) artifactError("invalid_type");
  return mime;
}

function parseTextFiles(value: unknown, type: Exclude<ArtifactType, "link">): Array<UploadFileInput & { body: Uint8Array }> {
  if (!Array.isArray(value) || value.length === 0) artifactError("invalid_manifest");
  const files = value.map((candidate) => {
    assertFields(candidate, ["path", "content", "mimeType"]);
    const path = normalizeArtifactPath(stringField(candidate.path, ARTIFACT_LIMITS.pathBytes)!);
    const content = stringField(candidate.content, ARTIFACT_LIMITS.mcpBytes)!;
    const mimeType = candidate.mimeType === undefined ? inferredMime(type, path) : stringField(candidate.mimeType, 128)!;
    if (mimeType !== inferredMime(type, path)) artifactError("invalid_type");
    const body = encoder.encode(content);
    return { path, mimeType, byteSize: body.byteLength, sha256: "", body };
  });
  if (files.length > ARTIFACT_LIMITS.mcpFiles || files.reduce((sum, file) => sum + file.byteSize, 0) > ARTIFACT_LIMITS.mcpBytes) artifactError("limit_exceeded");
  return files;
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function textMutation(
  env: Env,
  userId: string,
  rawInput: unknown,
  version: boolean,
): Promise<ArtifactMutationResult> {
  const allowed = version
    ? ["artifactId", "title", "description", "allowedDataOrigins", "idempotencyKey", "files"]
    : ["projectId", "type", "title", "description", "allowedDataOrigins", "idempotencyKey", "files"];
  assertFields(rawInput, allowed);
  let type: Exclude<ArtifactType, "link">;
  let projectId: string;
  let artifactId: string | undefined;
  if (version) {
    artifactId = stringField(rawInput.artifactId, 200)!;
    const artifact = await findOwnedArtifact(env, userId, artifactId);
    if (!artifact || artifact.type === "link") artifactError("not_found");
    type = artifact.type;
    projectId = artifact.project_id;
  } else {
    type = rawInput.type === "html" || rawInput.type === "file" ? rawInput.type : artifactError("invalid_input");
    projectId = stringField(rawInput.projectId, 200)!;
    if (!await findOwnedProject(env, userId, projectId)) artifactError("not_found");
  }
  const title = stringField(rawInput.title, ARTIFACT_LIMITS.titleChars)!;
  if (!title) artifactError("invalid_input");
  const description = stringField(rawInput.description, ARTIFACT_LIMITS.descriptionChars, false);
  const allowedDataOrigins = rawInput.allowedDataOrigins === undefined ? undefined : normalizeArtifactOrigins(rawInput.allowedDataOrigins as string[]);
  const files = parseTextFiles(rawInput.files, type);
  for (const file of files) file.sha256 = await checksum(file.body);
  const session = await createUploadSessionInternal(env, userId, {
    project: { projectId }, type, title, ...(description === undefined ? {} : { description }),
    ...(allowedDataOrigins === undefined ? {} : { allowedDataOrigins }), idempotencyKey: idempotencyKey(rawInput.idempotencyKey), ...(artifactId === undefined ? {} : { artifactId }),
  }, "mcp", files.map(({ body: _body, ...file }) => file));
  for (const file of files) {
    const { body, ...metadata } = file;
    await putUploadFile(env, userId, session.uploadId, metadata, body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  }
  return finalizeUpload(env, userId, session.uploadId);
}

/** MCP text packages are UTF-8 encoded and use the same leased upload pipeline as browser files. */
export async function createTextArtifact(env: Env, userId: string, input: unknown): Promise<ArtifactMutationResult> {
  return textMutation(env, userId, input, false);
}

export async function createTextArtifactVersion(env: Env, userId: string, input: unknown): Promise<ArtifactMutationResult> {
  return textMutation(env, userId, input, true);
}

type VersionRow = {
  id: string;
  artifact_id: string;
  version_number: number;
  source: "web" | "mcp";
  entry_path: string | null;
  external_url: string | null;
  allowed_data_origins: string;
  file_count: number;
  total_bytes: number;
  created_at: number;
};

type ArtifactRow = {
  id: string;
  project_id: string;
  project_title: string;
  title: string;
  description: string | null;
  type: ArtifactType;
  visibility: "private" | "gallery" | "public";
  current_version_id: string | null;
  gallery_version_id: string | null;
  updated_at: number;
  deleted_at: number | null;
};

function versionSummary(version: VersionRow | null): ArtifactVersionSummary | null {
  return version && {
    id: version.id,
    number: version.version_number,
    source: version.source,
    createdAt: version.created_at,
  };
}

function versionDetail(version: VersionRow, files: ArtifactFile[]): ArtifactVersionDetail {
  return {
    id: version.id,
    number: version.version_number,
    source: version.source,
    entryPath: version.entry_path,
    externalUrl: version.external_url,
    allowedDataOrigins: parseOrigins(version.allowed_data_origins),
    fileCount: version.file_count,
    totalBytes: version.total_bytes,
    createdAt: version.created_at,
    files,
  };
}

function presentation(artifact: ArtifactRow, currentVersion: VersionRow | null, galleryVersion: VersionRow | null): ArtifactPresentation {
  // Public remains a reserved database value and is never returned by this service.
  if (artifact.visibility === "public") artifactError("not_found");
  return {
    id: artifact.id,
    projectId: artifact.project_id,
    projectTitle: artifact.project_title,
    title: artifact.title,
    description: artifact.description,
    type: artifact.type,
    visibility: artifact.visibility,
    currentVersion: versionSummary(currentVersion),
    galleryVersion: versionSummary(galleryVersion),
    updatedAt: artifact.updated_at,
  };
}

async function filesForVersion(env: Env, versionId: string): Promise<ArtifactFile[]> {
  const rows = await env.DB.prepare(
    "SELECT path, mime_type, byte_size, sha256 FROM artifact_files WHERE version_id = ? ORDER BY path",
  ).bind(versionId).all<{ path: string; mime_type: string; byte_size: number; sha256: string }>();
  return rows.results.map((file) => ({
    path: file.path,
    mimeType: file.mime_type,
    byteSize: file.byte_size,
    sha256: file.sha256,
  }));
}

async function ownedArtifactRow(env: Env, userId: string, artifactId: string, includeRecoverable = false): Promise<ArtifactRow | null> {
  return env.DB.prepare(
    `SELECT a.id, a.project_id, p.title AS project_title, a.title, a.description, a.type,
       a.visibility, a.current_version_id, a.gallery_version_id, a.updated_at, a.deleted_at
     FROM artifacts a INNER JOIN projects p ON p.id = a.project_id AND p.user_id = a.user_id
     WHERE a.id = ? AND a.user_id = ? AND ${includeRecoverable ? "(a.deleted_at IS NULL OR a.deleted_at >= ?)" : "a.deleted_at IS NULL"} LIMIT 1`,
  ).bind(artifactId, userId, ...(includeRecoverable ? [now() - ARTIFACT_LIMITS.recoveryMs] : [])).first<ArtifactRow>();
}

async function versionById(env: Env, artifactId: string, versionId: string | null): Promise<VersionRow | null> {
  if (!versionId) return null;
  return env.DB.prepare(
    "SELECT id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_at FROM artifact_versions WHERE id = ? AND artifact_id = ? LIMIT 1",
  ).bind(versionId, artifactId).first<VersionRow>();
}

/** Returns an owned artifact with its current version. Missing and unowned are indistinguishable. */
export async function getOwnedArtifact(env: Env, userId: string, artifactId: string): Promise<ArtifactRead | null> {
  // Keep the repository's canonical ownership predicate as the first boundary check.
  if (!await findOwnedArtifact(env, userId, artifactId)) return null;
  const artifact = await ownedArtifactRow(env, userId, artifactId);
  if (!artifact || !artifact.current_version_id) return null;
  const [currentVersion, galleryVersion] = await Promise.all([
    versionById(env, artifact.id, artifact.current_version_id),
    versionById(env, artifact.id, artifact.gallery_version_id),
  ]);
  if (!currentVersion) return null;
  return {
    ...presentation(artifact, currentVersion, galleryVersion),
    version: versionDetail(currentVersion, await filesForVersion(env, currentVersion.id)),
  };
}

/** Owners can reopen a deleted artifact only while its 30-day recovery window is still active. */
export async function getOwnedRecoverableArtifact(env: Env, userId: string, artifactId: string): Promise<RecoverableArtifactRead | null> {
  if (!await findOwnedRecoverableArtifact(env, userId, artifactId, now() - ARTIFACT_LIMITS.recoveryMs)) return null;
  const artifact = await ownedArtifactRow(env, userId, artifactId, true);
  if (!artifact || !artifact.current_version_id) return null;
  const [currentVersion, galleryVersion] = await Promise.all([
    versionById(env, artifact.id, artifact.current_version_id),
    versionById(env, artifact.id, artifact.gallery_version_id),
  ]);
  if (!currentVersion) return null;
  return {
    ...presentation(artifact, currentVersion, galleryVersion),
    deletedAt: artifact.deleted_at,
    version: versionDetail(currentVersion, await filesForVersion(env, currentVersion.id)),
  };
}

/** Returns only the explicitly shared gallery version; current is never resolved for participants. */
export async function getGalleryArtifact(env: Env, artifactId: string): Promise<GalleryArtifactRead | null> {
  const gallery = await findGalleryArtifact(env, artifactId);
  if (!gallery) return null;
  const row = await env.DB.prepare(
    `SELECT a.id, a.project_id, p.title AS project_title, a.title, a.description, a.type,
       a.visibility, a.current_version_id, a.gallery_version_id, a.updated_at, u.name AS participant_name
     FROM artifacts a
     INNER JOIN projects p ON p.id = a.project_id AND p.user_id = a.user_id
     INNER JOIN users u ON u.id = a.user_id
     WHERE a.id = ? AND a.visibility = 'gallery' AND a.deleted_at IS NULL LIMIT 1`,
  ).bind(artifactId).first<ArtifactRow & { participant_name: string | null }>();
  if (!row) return null;
  const version: VersionRow = {
    id: gallery.version.id,
    artifact_id: gallery.version.artifact_id,
    version_number: gallery.version.version_number,
    source: gallery.version.source,
    entry_path: gallery.version.entry_path,
    external_url: gallery.version.external_url,
    allowed_data_origins: gallery.version.allowed_data_origins,
    file_count: gallery.version.file_count,
    total_bytes: gallery.version.total_bytes,
    created_at: gallery.version.created_at,
  };
  return {
    id: row.id,
    projectTitle: row.project_title,
    title: row.title,
    description: row.description,
    type: row.type,
    visibility: "gallery",
    updatedAt: row.updated_at,
    version: versionDetail(version, await filesForVersion(env, version.id)),
    participantDisplayName: row.participant_name?.trim() || "Participant",
  };
}

/** Owner-only summaries retain private IDs and project ownership context. */
export async function listOwnedArtifacts(env: Env, userId: string): Promise<ArtifactPresentation[]> {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.project_id, p.title AS project_title, a.title, a.description, a.type,
       a.visibility, a.current_version_id, a.gallery_version_id, a.updated_at, a.deleted_at
     FROM artifacts a INNER JOIN projects p ON p.id = a.project_id AND p.user_id = a.user_id
     WHERE a.user_id = ? AND a.deleted_at IS NULL AND a.visibility IN ('private', 'gallery')
     ORDER BY a.updated_at DESC, a.id`,
  ).bind(userId).all<ArtifactRow>();
  return Promise.all(rows.results.map(async (artifact) => presentation(
    artifact,
    await versionById(env, artifact.id, artifact.current_version_id),
    await versionById(env, artifact.id, artifact.gallery_version_id),
  )));
}

/** Project pages include the owner's still-recoverable deletions, but never expired rows. */
export async function listOwnedProjectArtifacts(env: Env, userId: string, projectId: string): Promise<RecoverableArtifactPresentation[]> {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.project_id, p.title AS project_title, a.title, a.description, a.type,
       a.visibility, a.current_version_id, a.gallery_version_id, a.updated_at, a.deleted_at
     FROM artifacts a INNER JOIN projects p ON p.id = a.project_id AND p.user_id = a.user_id
     WHERE a.user_id = ? AND a.project_id = ?
       AND (a.deleted_at IS NULL OR a.deleted_at >= ?)
       AND a.visibility IN ('private', 'gallery')
     ORDER BY a.updated_at DESC, a.id`,
  ).bind(userId, projectId, now() - ARTIFACT_LIMITS.recoveryMs).all<ArtifactRow>();
  return Promise.all(rows.results.map(async (artifact) => ({
    ...presentation(
      artifact,
      await versionById(env, artifact.id, artifact.current_version_id),
      await versionById(env, artifact.id, artifact.gallery_version_id),
    ),
    deletedAt: artifact.deleted_at,
  })));
}

/** Gallery summaries use the saved gallery pointer and expose no account identity. */
export async function listGalleryArtifacts(
  env: Env,
  clubId?: string,
): Promise<GalleryArtifactPresentation[]> {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.project_id, p.title AS project_title, a.title, a.description, a.type,
       a.visibility, a.current_version_id, a.gallery_version_id, a.updated_at, u.name AS participant_name,
       v.id AS version_id, v.artifact_id, v.version_number, v.source, v.entry_path, v.external_url,
       v.allowed_data_origins, v.file_count, v.total_bytes, v.created_at AS version_created_at
     FROM artifacts a
     INNER JOIN projects p ON p.id = a.project_id AND p.user_id = a.user_id
     INNER JOIN users u ON u.id = a.user_id
     INNER JOIN artifact_versions v ON v.id = a.gallery_version_id AND v.artifact_id = a.id
     WHERE a.visibility = 'gallery' AND a.deleted_at IS NULL
       AND (? IS NULL OR p.club_id = ?)
     ORDER BY a.updated_at DESC, a.id`,
  ).bind(clubId ?? null, clubId ?? null).all<ArtifactRow & { participant_name: string | null; version_id: string; version_created_at: number } & Omit<VersionRow, "id" | "created_at">>();
  return rows.results.map((row) => {
    const version: VersionRow = {
      id: row.version_id,
      artifact_id: row.artifact_id,
      version_number: row.version_number,
      source: row.source,
      entry_path: row.entry_path,
      external_url: row.external_url,
      allowed_data_origins: row.allowed_data_origins,
      file_count: row.file_count,
      total_bytes: row.total_bytes,
      created_at: row.version_created_at,
    };
    return {
      id: row.id,
      projectTitle: row.project_title,
      title: row.title,
      description: row.description,
      type: row.type,
      visibility: "gallery",
      updatedAt: row.updated_at,
      participantDisplayName: row.participant_name?.trim() || "Participant",
      version: versionSummary(version)!,
    };
  });
}

/** Retained versions are available only to the owner and have no storage keys. */
export async function listOwnedArtifactVersions(env: Env, userId: string, artifactId: string): Promise<ArtifactVersionDetail[] | null> {
  if (!await findOwnedArtifact(env, userId, artifactId)) return null;
  const versions = await env.DB.prepare(
    "SELECT id, artifact_id, version_number, source, entry_path, external_url, allowed_data_origins, file_count, total_bytes, created_at FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC",
  ).bind(artifactId).all<VersionRow>();
  return Promise.all(versions.results.map(async (version) => versionDetail(version, await filesForVersion(env, version.id))));
}

export async function updateArtifactMetadata(env: Env, userId: string, artifactId: string, input: unknown): Promise<void> {
  assertFields(input, ["title", "description"]);
  const rawTitle = input.title === undefined
    ? undefined
    : typeof input.title === "string"
      ? input.title
      : artifactError("invalid_input");
  const rawDescription = input.description === undefined || input.description === null
    ? input.description
    : typeof input.description === "string"
      ? input.description
      : artifactError("invalid_input");
  if (rawTitle === undefined && rawDescription === undefined) artifactError("invalid_input");
  const title = rawTitle === undefined ? undefined : trimAndCap(rawTitle, ARTIFACT_LIMITS.titleChars);
  if (title !== undefined && !title) artifactError("invalid_input");
  const description = rawDescription === undefined
    ? undefined
    : rawDescription === null
      ? null
      : trimAndCap(rawDescription, ARTIFACT_LIMITS.descriptionChars) || null;
  const result = await env.DB.prepare(
    `UPDATE artifacts SET title = COALESCE(?, title), description = CASE WHEN ? THEN ? ELSE description END, updated_at = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  ).bind(title ?? null, description !== undefined ? 1 : 0, description ?? null, now(), artifactId, userId).run();
  if (result.meta.changes !== 1) artifactError("not_found");
}

export async function restoreArtifactVersion(env: Env, userId: string, artifactId: string, versionId: string): Promise<void> {
  if (!await findOwnedVersion(env, userId, artifactId, versionId)) artifactError("not_found");
  const result = await env.DB.prepare(
    "UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
  ).bind(versionId, now(), artifactId, userId).run();
  if (result.meta.changes !== 1) artifactError("not_found");
}

/** Atomically enables gallery visibility and records the exact retained version. */
export async function shareArtifactVersion(env: Env, userId: string, artifactId: string, versionId: string): Promise<void> {
  if (!await findOwnedVersion(env, userId, artifactId, versionId)) artifactError("not_found");
  const result = await env.DB.prepare(
    `UPDATE artifacts SET visibility = 'gallery', gallery_version_id = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM artifact_versions WHERE id = ? AND artifact_id = artifacts.id)`,
  ).bind(versionId, now(), artifactId, userId, versionId).run();
  if (result.meta.changes !== 1) artifactError("not_found");
}

export async function unshareArtifact(env: Env, userId: string, artifactId: string): Promise<void> {
  const result = await env.DB.prepare(
    "UPDATE artifacts SET visibility = 'private', gallery_version_id = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
  ).bind(now(), artifactId, userId).run();
  if (result.meta.changes !== 1) artifactError("not_found");
}

/** The reserved public state is never an application-level transition. */
export async function setArtifactVisibility(
  env: Env,
  userId: string,
  artifactId: string,
  visibility: "private" | "gallery" | "public",
  versionId?: string,
): Promise<void> {
  if (visibility === "public") artifactError("invalid_input");
  if (visibility === "gallery") {
    if (!versionId) artifactError("invalid_input");
    return shareArtifactVersion(env, userId, artifactId, versionId);
  }
  return unshareArtifact(env, userId, artifactId);
}

export async function deleteArtifact(env: Env, userId: string, artifactId: string): Promise<void> {
  const result = await env.DB.prepare(
    "UPDATE artifacts SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
  ).bind(now(), now(), artifactId, userId).run();
  if (result.meta.changes !== 1) artifactError("not_found");
}

/** Recovery expires at the exact 30-day retention boundary. */
export async function recoverArtifact(env: Env, userId: string, artifactId: string): Promise<void> {
  const timestamp = now();
  const result = await env.DB.prepare(
    `UPDATE artifacts SET deleted_at = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL AND deleted_at >= ?`,
  ).bind(timestamp, artifactId, userId, timestamp - ARTIFACT_LIMITS.recoveryMs).run();
  if (result.meta.changes !== 1) artifactError("not_found");
}
