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

  it("finalizes only the owned upload's recorded files and leases", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-owned", "user-a", "artifact-owned", "version-owned", "project-a", "Owned artifact", "upload-key-owned", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, ?, ?, 'text/html', 5, ?, ?)").bind("upload-owned", "index.html", "artifacts/artifact-owned/versions/version-owned/index.html", "d".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind("artifacts/artifact-owned/versions/version-owned/index.html", "upload-owned", "user-a", "d".repeat(64), now + 1, now),
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-other", "user-a", "artifact-other", "version-other", "project-a", "Other artifact", "upload-key-other", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, ?, ?, 'text/html', 7, ?, ?)").bind("upload-other", "other.html", "artifacts/artifact-other/versions/version-other/other.html", "e".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 7, ?, ?, ?)").bind("artifacts/artifact-other/versions/version-other/other.html", "upload-other", "user-a", "e".repeat(64), now + 1, now),
    ]);

    await finalizeNewArtifact(env, "user-a", { uploadId: "upload-owned", now });

    const file = await env.DB.prepare("SELECT r2_key FROM artifact_files WHERE version_id = ?").bind("version-owned").first<{ r2_key: string }>();
    const unrelatedLease = await env.DB.prepare("SELECT upload_id FROM artifact_object_leases WHERE r2_key = ?").bind("artifacts/artifact-other/versions/version-other/other.html").first<{ upload_id: string }>();
    expect(file).toEqual({ r2_key: "artifacts/artifact-owned/versions/version-owned/index.html" });
    expect(unrelatedLease).toEqual({ upload_id: "upload-other" });
  });

  it("rejects a cross-user finalization without consuming that upload's lease", async () => {
    await expect(
      finalizeNewArtifact(env, "user-a", { uploadId: "upload-b", now }),
    ).rejects.toMatchObject({ code: "state_conflict" });

    await expect(findOwnedLease(env, "user-b", "artifacts/artifact-b/versions/version-upload-b/index.html")).resolves.toMatchObject({ upload_id: "upload-b" });
  });

  it("atomically finalizes a new artifact, its files, upload, and leases without publishing it", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-new", "user-a", "artifact-new", "version-new", "project-a", "New artifact", "upload-key-new", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, ?, ?, 'text/html', 5, ?, ?)").bind("upload-new", "index.html", "artifacts/artifact-new/versions/version-new/index.html", "b".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind("artifacts/artifact-new/versions/version-new/index.html", "upload-new", "user-a", "b".repeat(64), now + 1, now),
    ]);

    await finalizeNewArtifact(env, "user-a", {
      uploadId: "upload-new",
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

  it("rejects a manifest path changed to noncanonical form after preflight before the finalization batch", async () => {
    const uploadId = "upload-post-preflight";
    const artifactId = "artifact-post-preflight";
    const versionId = "version-post-preflight";
    const originalKey = `artifacts/${artifactId}/versions/${versionId}/index.html`;
    const mutatedPath = "../x";
    const mutatedKey = `artifacts/${artifactId}/versions/${versionId}/${mutatedPath}`;

    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind(uploadId, "user-a", artifactId, versionId, "project-a", "Post preflight", "upload-post-preflight-idempotency", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, 'index.html', ?, 'text/html', 5, ?, ?)").bind(uploadId, originalKey, "7".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind(originalKey, uploadId, "user-a", "7".repeat(64), now + 1, now),
    ]);

    let mutateBeforeBatch = true;
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (mutateBeforeBatch) {
              mutateBeforeBatch = false;
              await target.batch([
                target.prepare("UPDATE artifact_upload_files SET path = ?, r2_key = ? WHERE upload_id = ?").bind(mutatedPath, mutatedKey, uploadId),
                target.prepare("UPDATE artifact_object_leases SET r2_key = ? WHERE r2_key = ?").bind(mutatedKey, originalKey),
              ]);
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      finalizeNewArtifact({ DB: database } as Env, "user-a", { uploadId, now }),
    ).rejects.toMatchObject({ code: "state_conflict" });

    await expect(env.DB.prepare("SELECT id FROM artifacts WHERE id = ?").bind(artifactId).first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM artifact_versions WHERE id = ?").bind(versionId).first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_files WHERE version_id = ?").bind(versionId).first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind(uploadId).first()).resolves.toEqual({ status: "finalizing" });
    await expect(env.DB.prepare("SELECT path, r2_key FROM artifact_upload_files WHERE upload_id = ?").bind(uploadId).first()).resolves.toEqual({ path: mutatedPath, r2_key: mutatedKey });
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE upload_id = ?").bind(uploadId).first()).resolves.toEqual({ r2_key: mutatedKey });
  });

  it("derives the next owned version number and moves only the current pointer", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-version-a", "user-a", "artifact-a", "version-a-next", "project-a", "Artifact A", "upload-key-version-a", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, ?, ?, 'text/html', 5, ?, ?)").bind("upload-version-a", "index.html", "artifacts/artifact-a/versions/version-a-next/index.html", "c".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind("artifacts/artifact-a/versions/version-a-next/index.html", "upload-version-a", "user-a", "c".repeat(64), now + 1, now),
    ]);

    await finalizeExistingArtifactVersion(env, "user-a", {
      uploadId: "upload-version-a",
      now,
    });

    const version = await env.DB.prepare("SELECT version_number, file_count, total_bytes FROM artifact_versions WHERE id = ?").bind("version-a-next").first<{ version_number: number; file_count: number; total_bytes: number }>();
    const artifact = await env.DB.prepare("SELECT current_version_id, gallery_version_id FROM artifacts WHERE id = ?").bind("artifact-a").first<{ current_version_id: string; gallery_version_id: string }>();
    expect(version).toEqual({ version_number: 3, file_count: 1, total_bytes: 5 });
    expect(artifact).toEqual({ current_version_id: "version-a-next", gallery_version_id: "version-a-gallery" });
  });

  it("rejects a new upload whose manifest key escapes its recorded artifact version", async () => {
    const injectedKey = "artifacts/artifact-injected/versions/version-injected/index.html";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-key-new", "user-a", "artifact-key-new", "version-key-new", "project-a", "Key injection", "upload-key-new-idempotency", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, ?, ?, 'text/html', 5, ?, ?)").bind("upload-key-new", "index.html", injectedKey, "2".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind(injectedKey, "upload-key-new", "user-a", "2".repeat(64), now + 1, now),
    ]);

    await expect(finalizeNewArtifact(env, "user-a", { uploadId: "upload-key-new", now })).rejects.toMatchObject({ code: "state_conflict" });

    await expect(env.DB.prepare("SELECT id FROM artifacts WHERE id = ?").bind("artifact-key-new").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM artifact_versions WHERE id = ?").bind("version-key-new").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_files WHERE version_id = ?").bind("version-key-new").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind("upload-key-new").first()).resolves.toEqual({ status: "finalizing" });
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE r2_key = ?").bind(injectedKey).first()).resolves.toEqual({ r2_key: injectedKey });
  });

  it("rejects an existing upload whose manifest key targets another version", async () => {
    const injectedKey = "artifacts/artifact-a/versions/version-a-current/index.html";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-key-existing", "user-a", "artifact-a", "version-key-existing", "project-a", "Artifact A", "upload-key-existing-idempotency", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, ?, ?, 'text/html', 5, ?, ?)").bind("upload-key-existing", "index.html", injectedKey, "3".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind(injectedKey, "upload-key-existing", "user-a", "3".repeat(64), now + 1, now),
    ]);

    await expect(finalizeExistingArtifactVersion(env, "user-a", { uploadId: "upload-key-existing", now })).rejects.toMatchObject({ code: "state_conflict" });

    await expect(env.DB.prepare("SELECT id FROM artifact_versions WHERE id = ?").bind("version-key-existing").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_files WHERE version_id = ?").bind("version-key-existing").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT current_version_id FROM artifacts WHERE id = ?").bind("artifact-a").first()).resolves.toEqual({ current_version_id: "version-a-current" });
    await expect(env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind("upload-key-existing").first()).resolves.toEqual({ status: "finalizing" });
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE r2_key = ?").bind(injectedKey).first()).resolves.toEqual({ r2_key: injectedKey });
  });

  it("rejects a manifest key derived from an unnormalized stored path", async () => {
    const unnormalizedPath = "pages//index.html";
    const unnormalizedKey = `artifacts/artifact-unnormalized/versions/version-unnormalized/${unnormalizedPath}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-unnormalized", "user-a", "artifact-unnormalized", "version-unnormalized", "project-a", "Unnormalized", "upload-unnormalized-idempotency", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, ?, ?, 'text/html', 5, ?, ?)").bind("upload-unnormalized", unnormalizedPath, unnormalizedKey, "6".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind(unnormalizedKey, "upload-unnormalized", "user-a", "6".repeat(64), now + 1, now),
    ]);

    await expect(finalizeNewArtifact(env, "user-a", { uploadId: "upload-unnormalized", now })).rejects.toMatchObject({ code: "state_conflict" });

    await expect(env.DB.prepare("SELECT id FROM artifacts WHERE id = ?").bind("artifact-unnormalized").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind("upload-unnormalized").first()).resolves.toEqual({ status: "finalizing" });
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE r2_key = ?").bind(unnormalizedKey).first()).resolves.toEqual({ r2_key: unnormalizedKey });
  });

  it("rejects a new upload with no manifest files without consuming its lease", async () => {
    const leaseKey = "artifacts/artifact-empty-new/versions/version-empty-new/index.html";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-empty-new", "user-a", "artifact-empty-new", "version-empty-new", "project-a", "Empty artifact", "upload-empty-new-idempotency", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind(leaseKey, "upload-empty-new", "user-a", "4".repeat(64), now + 1, now),
    ]);

    await expect(finalizeNewArtifact(env, "user-a", { uploadId: "upload-empty-new", now })).rejects.toMatchObject({ code: "state_conflict" });

    await expect(env.DB.prepare("SELECT id FROM artifacts WHERE id = ?").bind("artifact-empty-new").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM artifact_versions WHERE id = ?").bind("version-empty-new").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind("upload-empty-new").first()).resolves.toEqual({ status: "finalizing" });
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE r2_key = ?").bind(leaseKey).first()).resolves.toEqual({ r2_key: leaseKey });
  });

  it("rejects an existing upload with no manifest files without moving its current version", async () => {
    const leaseKey = "artifacts/artifact-a/versions/version-empty-existing/index.html";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-empty-existing", "user-a", "artifact-a", "version-empty-existing", "project-a", "Artifact A", "upload-empty-existing-idempotency", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind(leaseKey, "upload-empty-existing", "user-a", "5".repeat(64), now + 1, now),
    ]);

    await expect(finalizeExistingArtifactVersion(env, "user-a", { uploadId: "upload-empty-existing", now })).rejects.toMatchObject({ code: "state_conflict" });

    await expect(env.DB.prepare("SELECT id FROM artifact_versions WHERE id = ?").bind("version-empty-existing").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT current_version_id FROM artifacts WHERE id = ?").bind("artifact-a").first()).resolves.toEqual({ current_version_id: "version-a-current" });
    await expect(env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind("upload-empty-existing").first()).resolves.toEqual({ status: "finalizing" });
    await expect(env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE r2_key = ?").bind(leaseKey).first()).resolves.toEqual({ r2_key: leaseKey });
  });

  it("rejects an expired finalizing upload without committing artifact state", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-expired", "user-a", "artifact-expired", "version-expired", "project-a", "Expired artifact", "upload-key-expired", now - 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, ?, ?, 'text/html', 5, ?, ?)").bind("upload-expired", "index.html", "artifacts/artifact-expired/versions/version-expired/index.html", "f".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind("artifacts/artifact-expired/versions/version-expired/index.html", "upload-expired", "user-a", "f".repeat(64), now + 1, now),
    ]);

    await expect(
      finalizeNewArtifact(env, "user-a", { uploadId: "upload-expired", now }),
    ).rejects.toMatchObject({ code: "state_conflict" });

    const artifact = await env.DB.prepare("SELECT id FROM artifacts WHERE id = ?").bind("artifact-expired").first();
    const version = await env.DB.prepare("SELECT id FROM artifact_versions WHERE id = ?").bind("version-expired").first();
    const file = await env.DB.prepare("SELECT r2_key FROM artifact_files WHERE version_id = ?").bind("version-expired").first();
    const upload = await env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind("upload-expired").first<{ status: string }>();
    const lease = await env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE upload_id = ?").bind("upload-expired").first();
    expect(artifact).toBeNull();
    expect(version).toBeNull();
    expect(file).toBeNull();
    expect(upload).toEqual({ status: "finalizing" });
    expect(lease).toEqual({ r2_key: "artifacts/artifact-expired/versions/version-expired/index.html" });
  });

  it("rejects an expired finalization lease without committing version state", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO artifact_uploads (id, user_id, artifact_id, version_id, project_id, type, title, allowed_data_origins, source, status, idempotency_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'html', ?, '[]', 'web', 'finalizing', ?, ?, ?, ?)").bind("upload-expired-lease", "user-a", "artifact-a", "version-expired-lease", "project-a", "Artifact A", "upload-key-expired-lease", now + 1, now, now),
      env.DB.prepare("INSERT INTO artifact_upload_files (upload_id, path, r2_key, mime_type, byte_size, sha256, created_at) VALUES (?, ?, ?, 'text/html', 5, ?, ?)").bind("upload-expired-lease", "index.html", "artifacts/artifact-a/versions/version-expired-lease/index.html", "1".repeat(64), now),
      env.DB.prepare("INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?, ?)").bind("artifacts/artifact-a/versions/version-expired-lease/index.html", "upload-expired-lease", "user-a", "1".repeat(64), now - 1, now),
    ]);

    await expect(
      finalizeExistingArtifactVersion(env, "user-a", { uploadId: "upload-expired-lease", now }),
    ).rejects.toMatchObject({ code: "state_conflict" });

    const version = await env.DB.prepare("SELECT id FROM artifact_versions WHERE id = ?").bind("version-expired-lease").first();
    const file = await env.DB.prepare("SELECT r2_key FROM artifact_files WHERE version_id = ?").bind("version-expired-lease").first();
    const artifact = await env.DB.prepare("SELECT current_version_id FROM artifacts WHERE id = ?").bind("artifact-a").first<{ current_version_id: string }>();
    const upload = await env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind("upload-expired-lease").first<{ status: string }>();
    const lease = await env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE upload_id = ?").bind("upload-expired-lease").first();
    expect(version).toBeNull();
    expect(file).toBeNull();
    expect(artifact).toEqual({ current_version_id: "version-a-current" });
    expect(upload).toEqual({ status: "finalizing" });
    expect(lease).toEqual({ r2_key: "artifacts/artifact-a/versions/version-expired-lease/index.html" });
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

  it("rejects link creation in another user's project without relying on the project trigger", async () => {
    await expect(
      finalizeNewLinkArtifact(env, "user-a", {
        artifact: { id: "artifact-cross-project", projectId: "project-b", type: "link", title: "Cross project", description: null },
        versionId: "version-cross-project",
        source: "browser",
        externalUrl: "https://example.com/cross-project",
        allowedDataOrigins: "[]",
        now,
      }),
    ).rejects.toMatchObject({ code: "state_conflict" });

    await expect(findOwnedArtifact(env, "user-a", "artifact-cross-project")).resolves.toBeNull();
    const version = await env.DB.prepare("SELECT id FROM artifact_versions WHERE id = ?").bind("version-cross-project").first();
    expect(version).toBeNull();
  });
});
