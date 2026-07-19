import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { ArtifactError } from "../../app/lib/artifacts/contracts";
import {
  createLinkArtifact,
  createTextArtifact,
  createTextArtifactVersion,
  createUploadSession,
  finalizeUpload,
  putUploadFile,
} from "../../app/lib/artifacts/service.server";

const now = 1_784_880_000_000;
const text = new TextEncoder();

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind("user-a", "a@example.com", now),
    env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind("user-b", "b@example.com", now),
    env.DB.prepare("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)").bind("project-a", "user-a", "Project A", now, now),
    env.DB.prepare("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'seed', ?, ?)").bind("project-b", "user-b", "Project B", now, now),
  ]);
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeEach(async () => {
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
  await seed();
});

describe("artifact upload service", () => {
  it("writes R2 before manifest rows then finalizes a private artifact from recorded state", async () => {
    const body = text.encode("<h1>Hello</h1>");
    const session = await createUploadSession(env, "user-a", {
      project: { projectId: "project-a" },
      type: "html",
      title: "Hello",
      idempotencyKey: "hello-upload",
    });

    await putUploadFile(env, "user-a", session.uploadId, {
      path: "index.html",
      mimeType: "text/html",
      byteSize: body.byteLength,
      sha256: await sha256(body),
    }, body.buffer);

    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_upload_files WHERE upload_id = ?").bind(session.uploadId).first<{ count: number }>()).resolves.toEqual({ count: 1 });

    const result = await finalizeUpload(env, "user-a", session.uploadId);
    expect(result).toEqual({ artifactId: session.artifactId, versionId: session.versionId });
    await expect(env.DB.prepare("SELECT visibility, current_version_id FROM artifacts WHERE id = ?").bind(session.artifactId).first()).resolves.toEqual({ visibility: "private", current_version_id: session.versionId });
    await expect(finalizeUpload(env, "user-a", session.uploadId)).resolves.toEqual(result);
  });

  it("rejects incomplete manifests without creating an artifact and retains the cleanup lease", async () => {
    const session = await createUploadSession(env, "user-a", {
      project: { projectId: "project-a" },
      type: "html",
      title: "Incomplete",
      idempotencyKey: "incomplete-upload",
    });

    await expect(finalizeUpload(env, "user-a", session.uploadId)).rejects.toMatchObject({ code: "invalid_manifest" } satisfies Partial<ArtifactError>);
    await expect(env.DB.prepare("SELECT id FROM artifacts WHERE id = ?").bind(session.artifactId).first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT status FROM artifact_uploads WHERE id = ?").bind(session.uploadId).first()).resolves.toEqual({ status: "failed" });
  });

  it("removes an inspection-rejected R2 object before D1 manifest recording and makes the failed upload unreadable", async () => {
    const body = text.encode("not a PNG");
    const session = await createUploadSession(env, "user-a", {
      project: { projectId: "project-a" },
      type: "file",
      title: "Bad image",
      idempotencyKey: "bad-image-upload",
    });

    await expect(putUploadFile(env, "user-a", session.uploadId, {
      path: "image.png",
      mimeType: "image/png",
      byteSize: body.byteLength,
      sha256: await sha256(body),
    }, body.buffer)).rejects.toMatchObject({ code: "invalid_type" } satisfies Partial<ArtifactError>);
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_upload_files WHERE upload_id = ?").bind(session.uploadId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_object_leases WHERE upload_id = ?").bind(session.uploadId).first<{ count: number }>()).resolves.toEqual({ count: 1 });

    await expect(finalizeUpload(env, "user-a", session.uploadId)).rejects.toMatchObject({ code: "invalid_manifest" } satisfies Partial<ArtifactError>);
    await expect(putUploadFile(env, "user-a", session.uploadId, {
      path: "image.png", mimeType: "image/png", byteSize: body.byteLength, sha256: await sha256(body),
    }, body.buffer)).rejects.toMatchObject({ code: "state_conflict" } satisfies Partial<ArtifactError>);
  });

  it("does not make a failed inline seed project visible", async () => {
    const session = await createUploadSession(env, "user-a", {
      project: { projectDraft: { title: "Invisible draft" } },
      type: "html",
      title: "Incomplete draft artifact",
      idempotencyKey: "invisible-draft-upload",
    });

    await expect(finalizeUpload(env, "user-a", session.uploadId)).rejects.toMatchObject({ code: "invalid_manifest" } satisfies Partial<ArtifactError>);
    await expect(env.DB.prepare("SELECT id FROM projects WHERE user_id = ? AND title = ?").bind("user-a", "Invisible draft").first()).resolves.toBeNull();
  });

  it("keeps project and type immutable while MCP text versions move only current", async () => {
    const created = await createTextArtifact(env, "user-a", {
      projectId: "project-a",
      type: "file",
      title: "Notes",
      idempotencyKey: "notes-create",
      files: [{ path: "notes.txt", content: "first" }],
    });
    const next = await createTextArtifactVersion(env, "user-a", {
      artifactId: created.artifactId,
      title: "Ignored by immutable artifact metadata",
      idempotencyKey: "notes-version-2",
      files: [{ path: "notes.txt", content: "second" }],
    });

    const artifact = await env.DB.prepare("SELECT project_id, type, current_version_id, gallery_version_id FROM artifacts WHERE id = ?").bind(created.artifactId).first();
    expect(artifact).toEqual({ project_id: "project-a", type: "file", current_version_id: next.versionId, gallery_version_id: null });
  });

  it("uses the normalized link URL in the idempotency fingerprint", async () => {
    const input = {
      project: { projectId: "project-a" },
      title: "Reference",
      url: "https://example.com/reference",
      idempotencyKey: "reference-link",
    };
    await createLinkArtifact(env, "user-a", input);

    await expect(createLinkArtifact(env, "user-a", { ...input, url: "https://example.com/other" })).rejects.toMatchObject({
      code: "idempotency_conflict",
    } satisfies Partial<ArtifactError>);
  });
});
