import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  findGalleryArtifact,
  findOwnedArtifact,
  findOwnedIdempotency,
  findOwnedLease,
  findOwnedProject,
  findOwnedUpload,
  findOwnedVersion,
  finalizeExistingArtifactVersion,
  finalizeNewArtifact,
  finalizeNewLinkArtifact,
  markOwnedUploadAborted,
} from "../../app/lib/artifacts/repository.server";

const now = 1_784_880_000_000;

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind("user-a", "a@example.com", now),
    env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind("user-b", "b@example.com", now),
    env.DB.prepare("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)").bind("project-a", "user-a", "Project A", now, now),
    env.DB.prepare("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)").bind("project-b", "user-b", "Project B", now, now),
    env.DB.prepare("INSERT INTO artifacts (id, user_id, project_id, type, title, visibility, created_at, updated_at) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?)").bind("artifact-a", "user-a", "project-a", "Artifact A", now, now),
    env.DB.prepare("INSERT INTO artifacts (id, user_id, project_id, type, title, visibility, created_at, updated_at) VALUES (?, ?, ?, 'html', ?, 'private', ?, ?)").bind("artifact-b", "user-b", "project-b", "Artifact B", now, now),
    env.DB.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, allowed_data_origins, file_count, total_bytes, created_by, created_at) VALUES (?, ?, 1, 'web', 'index.html', '[]', 1, 5, ?, ?)").bind("version-a-current", "artifact-a", "user-a", now),
    env.DB.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, allowed_data_origins, file_count, total_bytes, created_by, created_at) VALUES (?, ?, 2, 'web', 'index.html', '[]', 1, 5, ?, ?)").bind("version-a-gallery", "artifact-a", "user-a", now),
    env.DB.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, allowed_data_origins, file_count, total_bytes, created_by, created_at) VALUES (?, ?, 1, 'web', 'index.html', '[]', 1, 5, ?, ?)").bind("version-b", "artifact-b", "user-b", now),
    env.DB.prepare("UPDATE artifacts SET current_version_id = ?, gallery_version_id = ? WHERE id = ?").bind("version-a-current", "version-a-gallery", "artifact-a"),
    env.DB.prepare("UPDATE artifacts SET current_version_id = ?, gallery_version_id = ? WHERE id = ?").bind("version-b", "version-b", "artifact-b"),
    env.DB.prepare("UPDATE artifacts SET visibility = 'gallery' WHERE id IN ('artifact-a', 'artifact-b')"),
    env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'pending', ?, ?, ?, ?)").bind("upload-b", "user-b", "artifact-b", "version-upload-b", "project-b", "Upload B", "upload-key-b", now + 1, now, now),
    env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind("artifacts/artifact-b/versions/version-upload-b/index.html", "upload-b", "user-b", "a".repeat(64), now + 1, now),
    env.DB.prepare("INSERT INTO artifact_idempotency (user_id, operation, target_key, idempotency_key, fingerprint, artifact_id, version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("user-b", "create_version", "artifact-b", "idempotency-b", "fingerprint-b", "artifact-b", "version-b", now),
  ]);
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM artifact_idempotency"),
    env.DB.prepare("DELETE FROM artifact_object_leases"),
    env.DB.prepare("DELETE FROM artifact_upload_files"),
    env.DB.prepare("DELETE FROM artifact_uploads"),
    env.DB.prepare("DELETE FROM artifact_files"),
    env.DB.prepare("DELETE FROM artifacts"),
    env.DB.prepare("DELETE FROM artifact_versions"),
    env.DB.prepare("DELETE FROM projects"),
    env.DB.prepare("DELETE FROM users"),
  ]);
  await seed();
});

describe("owned artifact repository", () => {
  it("does not expose another user's project, upload, artifact, version, lease, or idempotency row", async () => {
    await expect(findOwnedProject(env, "user-a", "project-b")).resolves.toBeNull();
    await expect(findOwnedUpload(env, "user-a", "upload-b")).resolves.toBeNull();
    await expect(findOwnedArtifact(env, "user-a", "artifact-b")).resolves.toBeNull();
    await expect(findOwnedVersion(env, "user-a", "artifact-b", "version-b")).resolves.toBeNull();
    await expect(findOwnedLease(env, "user-a", "artifacts/artifact-b/versions/version-upload-b/index.html")).resolves.toBeNull();
    await expect(findOwnedIdempotency(env, "user-a", "create_version", "artifact-b", "idempotency-b")).resolves.toBeNull();
  });

  it("does not mutate another user's upload", async () => {
    await expect(markOwnedUploadAborted(env, "user-a", "upload-b", now)).resolves.toBe(false);
    const upload = await env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind("upload-b").first<{ status: string }>();
    expect(upload?.status).toBe("pending");
  });

  it("resolves the explicitly published gallery version rather than the current version", async () => {
    const gallery = await findGalleryArtifact(env, "artifact-a");
    expect(gallery?.version.id).toBe("version-a-gallery");
    expect(gallery?.version.id).not.toBe("version-a-current");
  });

  it("atomically finalizes a new artifact, its files, upload, and leases without publishing it", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-new", "user-a", "artifact-new", "version-new", "project-a", "New artifact", "upload-key-new", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind("artifacts/artifact-new/versions/version-new/index.html", "upload-new", "user-a", "b".repeat(64), now + 1, now),
    ]);

    await finalizeNewArtifact(env, "user-a", {
      uploadId: "upload-new",
      artifact: { id: "artifact-new", projectId: "project-a", type: "html", title: "New artifact", description: null },
      version: { id: "version-new", source: "browser", entryPath: "index.html", externalUrl: null, allowedDataOrigins: "[]", fileCount: 1, totalBytes: 5 },
      files: [{ path: "index.html", r2Key: "artifacts/artifact-new/versions/version-new/index.html", mimeType: "text/html", byteSize: 5, sha256: "b".repeat(64) }],
      now,
    });

    const artifact = await env.DB.prepare("SELECT current_version_id, gallery_version_id, visibility FROM artifacts WHERE id = ?").bind("artifact-new").first<{ current_version_id: string; gallery_version_id: string | null; visibility: string }>();
    const upload = await env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind("upload-new").first<{ status: string }>();
    const file = await env.DB.prepare("SELECT version_id FROM artifact_files WHERE r2_key = ?").bind("artifacts/artifact-new/versions/version-new/index.html").first<{ version_id: string }>();
    expect(artifact).toEqual({ current_version_id: "version-new", gallery_version_id: null, visibility: "private" });
    expect(upload?.status).toBe("complete");
    expect(file?.version_id).toBe("version-new");
    await expect(findOwnedLease(env, "user-a", "artifacts/artifact-new/versions/version-new/index.html")).resolves.toBeNull();
  });

  it("derives the next owned version number and moves only the current pointer", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-version-a", "user-a", "artifact-a", "version-a-next", "project-a", "Artifact A", "upload-key-version-a", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind("artifacts/artifact-a/versions/version-a-next/index.html", "upload-version-a", "user-a", "c".repeat(64), now + 1, now),
    ]);

    await finalizeExistingArtifactVersion(env, "user-a", {
      uploadId: "upload-version-a",
      artifactId: "artifact-a",
      version: { id: "version-a-next", source: "browser", entryPath: "index.html", externalUrl: null, allowedDataOrigins: "[]", fileCount: 1, totalBytes: 5 },
      files: [{ path: "index.html", r2Key: "artifacts/artifact-a/versions/version-a-next/index.html", mimeType: "text/html", byteSize: 5, sha256: "c".repeat(64) }],
      now,
    });

    const version = await env.DB.prepare("SELECT version_number FROM artifact_versions WHERE id = ?").bind("version-a-next").first<{ version_number: number }>();
    const artifact = await env.DB.prepare("SELECT current_version_id, gallery_version_id FROM artifacts WHERE id = ?").bind("artifact-a").first<{ current_version_id: string; gallery_version_id: string }>();
    expect(version?.version_number).toBe(3);
    expect(artifact).toEqual({ current_version_id: "version-a-next", gallery_version_id: "version-a-gallery" });
  });

  it("atomically creates a private link artifact with its first current version", async () => {
    await finalizeNewLinkArtifact(env, "user-a", {
      artifact: { id: "artifact-link", projectId: "project-a", type: "link", title: "Link", description: null },
      versionId: "version-link",
      source: "browser",
      externalUrl: "https://example.com/report",
      allowedDataOrigins: "[]",
      now,
    });

    const artifact = await env.DB.prepare("SELECT current_version_id, gallery_version_id, visibility FROM artifacts WHERE id = ?").bind("artifact-link").first<{ current_version_id: string; gallery_version_id: string | null; visibility: string }>();
    const version = await env.DB.prepare("SELECT version_number, external_url, file_count FROM artifact_versions WHERE id = ?").bind("version-link").first<{ version_number: number; external_url: string; file_count: number }>();
    expect(artifact).toEqual({ current_version_id: "version-link", gallery_version_id: null, visibility: "private" });
    expect(version).toEqual({ version_number: 1, external_url: "https://example.com/report", file_count: 0 });
  });
});
