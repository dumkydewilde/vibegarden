import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactError, ARTIFACT_LIMITS } from "../../app/lib/artifacts/contracts";
import {
  deleteArtifact,
  createTextArtifactVersion,
  getGalleryArtifact,
  getOwnedArtifact,
  getOwnedRecoverableArtifact,
  listGalleryArtifacts,
  listOwnedProjectArtifacts,
  recoverArtifact,
  restoreArtifactVersion,
  setArtifactVisibility,
  shareArtifactVersion,
  unshareArtifact,
  updateArtifactMetadata,
} from "../../app/lib/artifacts/service.server";
import { presentGalleryArtifact } from "../../app/lib/artifacts/presenters.server";

const timestamp = 1_784_880_000_000;

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").bind("owner", "owner@example.com", "Owner Name", timestamp),
    env.DB.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").bind("other", "other@example.com", "Other Name", timestamp),
    env.DB.prepare("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)").bind("project", "owner", "Garden project", timestamp, timestamp),
    env.DB.prepare("INSERT INTO artifacts (id, user_id, project_id, type, title, description, visibility, created_at, updated_at) VALUES (?, ?, ?, 'html', ?, ?, 'private', ?, ?)").bind("artifact", "owner", "project", "Private artifact", "First description", timestamp, timestamp),
    env.DB.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, allowed_data_origins, file_count, total_bytes, created_by, created_at) VALUES (?, ?, 1, 'web', 'index.html', ?, 1, 5, ?, ?)").bind("version-1", "artifact", JSON.stringify(["https://api.example.com"]), "owner", timestamp),
    env.DB.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, source, entry_path, allowed_data_origins, file_count, total_bytes, created_by, created_at) VALUES (?, ?, 2, 'mcp', 'index.html', '[]', 1, 7, ?, ?)").bind("version-2", "artifact", "owner", timestamp + 1),
    env.DB.prepare("UPDATE artifacts SET current_version_id = ? WHERE id = ?").bind("version-2", "artifact"),
  ]);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(timestamp + 10_000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM artifact_files"),
    env.DB.prepare("DELETE FROM artifact_idempotency"),
    env.DB.prepare("DELETE FROM artifact_object_leases"),
    env.DB.prepare("DELETE FROM artifact_upload_files"),
    env.DB.prepare("DELETE FROM artifact_uploads"),
    env.DB.prepare("DELETE FROM artifact_versions"),
    env.DB.prepare("DELETE FROM artifacts"),
    env.DB.prepare("DELETE FROM projects"),
    env.DB.prepare("DELETE FROM users"),
  ]);
  await seed();
});

describe("artifact lifecycle visibility state table", () => {
  it("keeps creation private, shares an exact version, and only moves current when a later upload finalizes", async () => {
    await expect(getOwnedArtifact(env, "owner", "artifact")).resolves.toMatchObject({ version: { id: "version-2" } });
    await expect(getGalleryArtifact(env, "artifact")).resolves.toBeNull();

    await shareArtifactVersion(env, "owner", "artifact", "version-1");
    const gallery = await getGalleryArtifact(env, "artifact");
    expect(gallery).toMatchObject({ version: { id: "version-1" }, participantDisplayName: "Owner Name" });
    expect(JSON.stringify(gallery)).not.toMatch(/projectId|owner@example|\"owner\"|currentVersion|version-2/);
    const galleryList = await listGalleryArtifacts(env);
    expect(presentGalleryArtifact(galleryList[0]!)).toMatchObject({
      project: { title: "Garden project" },
      participant: { displayName: "Owner Name" },
      version: { id: "version-1" },
    });

    const uploaded = await createTextArtifactVersion(env, "owner", {
      artifactId: "artifact",
      title: "Current-only upload",
      idempotencyKey: "current-only-upload",
      files: [{ path: "index.html", content: "<h1>Current only</h1>" }],
    });
    await expect(getOwnedArtifact(env, "owner", "artifact")).resolves.toMatchObject({ version: { id: uploaded.versionId } });
    await expect(getGalleryArtifact(env, "artifact")).resolves.toMatchObject({ version: { id: "version-1" } });
  });

  it("restores current only, updates and removes gallery visibility, and never permits public", async () => {
    await shareArtifactVersion(env, "owner", "artifact", "version-1");
    await restoreArtifactVersion(env, "owner", "artifact", "version-1");
    await expect(getOwnedArtifact(env, "owner", "artifact")).resolves.toMatchObject({ version: { id: "version-1" } });
    await expect(getGalleryArtifact(env, "artifact")).resolves.toMatchObject({ version: { id: "version-1" } });

    await shareArtifactVersion(env, "owner", "artifact", "version-2");
    await expect(getGalleryArtifact(env, "artifact")).resolves.toMatchObject({ version: { id: "version-2" } });
    await unshareArtifact(env, "owner", "artifact");
    await expect(getGalleryArtifact(env, "artifact")).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT visibility, gallery_version_id FROM artifacts WHERE id = ?").bind("artifact").first()).resolves.toEqual({ visibility: "private", gallery_version_id: null });
    await expect(setArtifactVisibility(env, "owner", "artifact", "public")).rejects.toMatchObject({ code: "invalid_input" } satisfies Partial<ArtifactError>);
  });

  it("updates trimmed metadata without creating a version and rejects ownership leaks", async () => {
    await updateArtifactMetadata(env, "owner", "artifact", { title: "  Renamed  ", description: "  Changed  " });
    await expect(env.DB.prepare("SELECT title, description FROM artifacts WHERE id = ?").bind("artifact").first()).resolves.toEqual({ title: "Renamed", description: "Changed" });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE artifact_id = ?").bind("artifact").first()).resolves.toEqual({ count: 2 });
    await expect(shareArtifactVersion(env, "other", "artifact", "version-1")).rejects.toMatchObject({ code: "not_found" } satisfies Partial<ArtifactError>);
  });

  it("caps arbitrarily long metadata after trimming instead of rejecting it", async () => {
    const title = `  ${"t".repeat(10_001)}  `;
    const description = `  ${"d".repeat(100_001)}  `;

    await updateArtifactMetadata(env, "owner", "artifact", { title, description });

    await expect(env.DB.prepare("SELECT title, description FROM artifacts WHERE id = ?").bind("artifact").first()).resolves.toEqual({
      title: "t".repeat(ARTIFACT_LIMITS.titleChars),
      description: "d".repeat(ARTIFACT_LIMITS.descriptionChars),
    });
  });

  it("hides soft-deleted artifacts immediately and recovers only during the exact 30-day window", async () => {
    await shareArtifactVersion(env, "owner", "artifact", "version-1");
    await deleteArtifact(env, "owner", "artifact");
    await expect(getOwnedArtifact(env, "owner", "artifact")).resolves.toBeNull();
    await expect(getGalleryArtifact(env, "artifact")).resolves.toBeNull();
    await recoverArtifact(env, "owner", "artifact");
    await expect(getOwnedArtifact(env, "owner", "artifact")).resolves.toMatchObject({ version: { id: "version-2" } });
    await expect(getGalleryArtifact(env, "artifact")).resolves.toMatchObject({ version: { id: "version-1" } });

    await deleteArtifact(env, "owner", "artifact");
    vi.setSystemTime(Date.now() + ARTIFACT_LIMITS.recoveryMs + 1);
    await expect(recoverArtifact(env, "owner", "artifact")).rejects.toMatchObject({ code: "not_found" } satisfies Partial<ArtifactError>);
  });

  it("keeps a recoverable owner artifact available to detail and project linkage while excluding it from the gallery", async () => {
    await shareArtifactVersion(env, "owner", "artifact", "version-1");
    await deleteArtifact(env, "owner", "artifact");

    await expect(getOwnedRecoverableArtifact(env, "owner", "artifact")).resolves.toMatchObject({
      id: "artifact",
      deletedAt: expect.any(Number),
      version: { id: "version-2" },
    });
    await expect(listOwnedProjectArtifacts(env, "owner", "project")).resolves.toMatchObject([
      { id: "artifact", deletedAt: expect.any(Number), currentVersion: { id: "version-2" } },
    ]);
    await expect(listGalleryArtifacts(env)).resolves.toEqual([]);

    vi.setSystemTime(Date.now() + ARTIFACT_LIMITS.recoveryMs + 1);
    await expect(getOwnedRecoverableArtifact(env, "owner", "artifact")).resolves.toBeNull();
    await expect(listOwnedProjectArtifacts(env, "owner", "project")).resolves.toEqual([]);
  });
});
