import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { ArtifactError } from "../../app/lib/artifacts/contracts";
import {
  createLinkArtifact,
  createLinkArtifactVersion,
  createTextArtifact,
  createTextArtifactVersion,
  createUploadSession,
  finalizeUpload,
  putUploadFile,
} from "../../app/lib/artifacts/service.server";
import { artifactObjectKey, putLeasedObject } from "../../app/lib/artifacts/object-store.server";

const now = 1_784_880_000_000;
const text = new TextEncoder();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function finalizationRaceEnv(
  role: "winner" | "loser",
  barriers: { loserReadPending: ReturnType<typeof deferred>; winnerTransitioned: ReturnType<typeof deferred>; releaseLoser: ReturnType<typeof deferred>; releaseWinner: ReturnType<typeof deferred> },
): Env {
  let delayedInitialLoad = false;
  let winnerTransitioned = false;
  const db = new Proxy(env.DB, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "prepare" || typeof value !== "function") return value;
      return (query: string) => {
        const isOwnedUpload = query === "SELECT * FROM artifact_uploads WHERE id = ? AND user_id = ? LIMIT 1";
        const isTransition = query.startsWith("UPDATE artifact_uploads SET status = 'finalizing'");
        const isFileLoad = query.startsWith("SELECT path, mime_type AS mimeType");
        const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
          get(statementTarget, statementProperty, statementReceiver) {
            const statementValue = Reflect.get(statementTarget, statementProperty, statementReceiver);
            if (statementProperty === "bind") {
              return (...args: unknown[]) => wrap(
                (statementValue as (...values: unknown[]) => D1PreparedStatement).apply(statementTarget, args),
              );
            }
            if (role === "loser" && isOwnedUpload && statementProperty === "first" && !delayedInitialLoad) {
              delayedInitialLoad = true;
              return async (...args: unknown[]) => {
                const result = await (statementValue as (...values: unknown[]) => Promise<unknown>).apply(statementTarget, args);
                barriers.loserReadPending.resolve();
                await barriers.winnerTransitioned.promise;
                return result;
              };
            }
            if (role === "winner" && isTransition && statementProperty === "run") {
              return async (...args: unknown[]) => {
                const result = await (statementValue as (...values: unknown[]) => Promise<unknown>).apply(statementTarget, args);
                winnerTransitioned = true;
                barriers.winnerTransitioned.resolve();
                return result;
              };
            }
            if (role === "winner" && winnerTransitioned && isFileLoad && statementProperty === "all") {
              return async (...args: unknown[]) => {
                await barriers.releaseWinner.promise;
                return (statementValue as (...values: unknown[]) => Promise<unknown>).apply(statementTarget, args);
              };
            }
            if (role === "loser" && isTransition && statementProperty === "run") {
              return async (...args: unknown[]) => {
                await barriers.releaseLoser.promise;
                return (statementValue as (...values: unknown[]) => Promise<unknown>).apply(statementTarget, args);
              };
            }
            return statementValue;
          },
        }) as D1PreparedStatement;
        return wrap(target.prepare(query));
      };
    },
  });
  return { ...env, DB: db } as Env;
}

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind("user-a", "a@example.com", now),
    env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind("user-b", "b@example.com", now),
    env.DB.prepare("INSERT INTO clubs (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("club-a", "Club A", "club-a", now, now),
    env.DB.prepare("INSERT INTO clubs (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("club-other", "Other Club", "club-other", now, now),
    env.DB.prepare("INSERT INTO projects (id, user_id, club_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'seed', ?, ?)").bind("project-a", "user-a", "club-a", "Project A", now, now),
    env.DB.prepare("INSERT INTO projects (id, user_id, club_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'seed', ?, ?)").bind("project-other-club", "user-a", "club-other", "Other Club Project", now, now),
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
    env.DB.prepare("DELETE FROM clubs"),
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
    const created = await createTextArtifact(env, { userId: "user-a", clubId: "club-a" }, {
      projectId: "project-a",
      type: "file",
      title: "Notes",
      idempotencyKey: "notes-create",
      files: [{ path: "notes.txt", content: "first" }],
    });
    const next = await createTextArtifactVersion(env, { userId: "user-a", clubId: "club-a" }, {
      artifactId: created.artifactId,
      idempotencyKey: "notes-version-2",
      files: [{ path: "notes.txt", content: "second" }],
    });

    const artifact = await env.DB.prepare("SELECT project_id, type, current_version_id, gallery_version_id FROM artifacts WHERE id = ?").bind(created.artifactId).first();
    expect(artifact).toEqual({ project_id: "project-a", type: "file", current_version_id: next.versionId, gallery_version_id: null });
  });

  it("finalizes a pending MCP replay after all of its files were recorded", async () => {
    const input = {
      projectId: "project-a",
      type: "html" as const,
      title: "Pending replay",
      idempotencyKey: "pending-mcp-replay",
      files: [{ path: "index.html", content: "<h1>Pending replay</h1>" }],
    };
    const created = await createTextArtifact(env, { userId: "user-a", clubId: "club-a" }, input);
    const upload = await env.DB.prepare(
      "SELECT id FROM artifact_uploads WHERE artifact_id = ? AND version_id = ?",
    ).bind(created.artifactId, created.versionId).first<{ id: string }>();
    const files = await env.DB.prepare(
      "SELECT r2_key, byte_size, sha256 FROM artifact_upload_files WHERE upload_id = ?",
    ).bind(upload!.id).all<{ r2_key: string; byte_size: number; sha256: string }>();

    await env.DB.batch([
      env.DB.prepare("DELETE FROM artifact_files WHERE version_id = ?").bind(created.versionId),
      env.DB.prepare("DELETE FROM artifact_versions WHERE id = ?").bind(created.versionId),
      env.DB.prepare("DELETE FROM artifacts WHERE id = ?").bind(created.artifactId),
      env.DB.prepare("UPDATE artifact_uploads SET status = 'pending' WHERE id = ?").bind(upload!.id),
      ...files.results.map((file) => env.DB.prepare(
        "INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, 'user-a', ?, ?, ?, ?)",
      ).bind(file.r2_key, upload!.id, file.byte_size, file.sha256, Date.now() + 60_000, Date.now())),
    ]);

    await expect(createTextArtifact(env, { userId: "user-a", clubId: "club-a" }, input)).resolves.toEqual(created);
    await expect(env.DB.prepare("SELECT current_version_id FROM artifacts WHERE id = ?").bind(created.artifactId).first()).resolves.toEqual({ current_version_id: created.versionId });
  });

  it("completes both callers when a loser observes the winner's finalizing transition", async () => {
    const body = text.encode("<h1>Concurrent</h1>");
    const session = await createUploadSession(env, "user-a", {
      project: { projectId: "project-a" }, type: "html", title: "Concurrent", idempotencyKey: "concurrent-transition",
    });
    await putUploadFile(env, "user-a", session.uploadId, {
      path: "index.html", mimeType: "text/html", byteSize: body.byteLength, sha256: await sha256(body),
    }, body.buffer);
    const barriers = {
      loserReadPending: deferred(), winnerTransitioned: deferred(), releaseLoser: deferred(), releaseWinner: deferred(),
    };
    const loser = finalizeUpload(finalizationRaceEnv("loser", barriers), "user-a", session.uploadId);
    await barriers.loserReadPending.promise;
    const winner = finalizeUpload(finalizationRaceEnv("winner", barriers), "user-a", session.uploadId);
    await barriers.winnerTransitioned.promise;
    barriers.releaseLoser.resolve();

    try {
      const loserResult = await loser;
      barriers.releaseWinner.resolve();
      const winnerResult = await winner;
      expect(loserResult).toEqual({ artifactId: session.artifactId, versionId: session.versionId });
      expect(winnerResult).toEqual(loserResult);
    } finally {
      barriers.releaseWinner.resolve();
      await winner.catch(() => undefined);
    }
  });

  it("rejects same-user MCP text writes outside the selected club", async () => {
    await expect(createTextArtifact(env, { userId: "user-a", clubId: "club-a" }, {
      projectId: "project-other-club",
      type: "html",
      title: "Wrong club",
      idempotencyKey: "wrong-club-create",
      files: [{ path: "index.html", content: "<h1>Wrong club</h1>" }],
    })).rejects.toMatchObject({ code: "not_found" });
  });

  it("creates a scoped version without accepting mutable metadata", async () => {
    const created = await createTextArtifact(env, { userId: "user-a", clubId: "club-a" }, {
      projectId: "project-a",
      type: "html",
      title: "Original title",
      description: "Original description",
      idempotencyKey: "scoped-create",
      files: [{ path: "index.html", content: "<h1>One</h1>" }],
    });
    await expect(createTextArtifactVersion(env, { userId: "user-a", clubId: "club-a" }, {
      artifactId: created.artifactId,
      idempotencyKey: "scoped-version",
      files: [{ path: "index.html", content: "<h1>Two</h1>" }],
    })).resolves.toEqual({ artifactId: created.artifactId, versionId: expect.any(String) });
    await expect(createTextArtifactVersion(env, { userId: "user-a", clubId: "club-a" }, {
      artifactId: created.artifactId,
      title: "Injected title",
      idempotencyKey: "scoped-version-with-title",
      files: [{ path: "index.html", content: "<h1>Three</h1>" }],
    } as never)).rejects.toMatchObject({ code: "invalid_input" });
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

  it("retains explicitly confirmed origins on a replacement link version", async () => {
    const created = await createLinkArtifact(env, "user-a", {
      project: { projectId: "project-a" },
      title: "Reference",
      url: "https://example.com/reference",
      idempotencyKey: "reference-link-create",
    });

    const replacement = await createLinkArtifactVersion(env, "user-a", {
      artifactId: created.artifactId,
      url: "https://example.com/replacement",
      allowedDataOrigins: ["https://data.example.com"],
      idempotencyKey: "reference-link-replacement",
    });

    await expect(env.DB.prepare("SELECT external_url, allowed_data_origins FROM artifact_versions WHERE id = ?").bind(replacement.versionId).first()).resolves.toEqual({
      external_url: "https://example.com/replacement",
      allowed_data_origins: JSON.stringify(["https://data.example.com"]),
    });
  });

  it("rejects a declared byte size that differs from R2 before recording the manifest and retains its lease", async () => {
    const body = text.encode("<h1>Size mismatch</h1>");
    const session = await createUploadSession(env, "user-a", {
      project: { projectId: "project-a" },
      type: "html",
      title: "Size mismatch",
      idempotencyKey: "size-mismatch-upload",
    });

    await expect(putUploadFile(env, "user-a", session.uploadId, {
      path: "index.html",
      mimeType: "text/html",
      byteSize: body.byteLength + 1,
      sha256: await sha256(body),
    }, body.buffer)).rejects.toMatchObject({ code: "invalid_manifest" } satisfies Partial<ArtifactError>);

    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_upload_files WHERE upload_id = ?").bind(session.uploadId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
    await expect(env.DB.prepare("SELECT byte_size FROM artifact_object_leases WHERE upload_id = ?").bind(session.uploadId).first<{ byte_size: number }>()).resolves.toEqual({ byte_size: body.byteLength + 1 });
  });

  it("recovers a same-checksum object left after the R2 write, while changed retry bytes still conflict", async () => {
    const body = text.encode("<h1>Recover</h1>");
    const checksum = await sha256(body);
    const session = await createUploadSession(env, "user-a", {
      project: { projectId: "project-a" },
      type: "html",
      title: "Recovery",
      idempotencyKey: "recover-r2-before-d1",
    });
    const r2Key = artifactObjectKey(session.artifactId, session.versionId, "index.html");
    await env.DB.prepare(
      "INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(r2Key, session.uploadId, "user-a", body.byteLength, checksum, Date.now() + 60_000, Date.now()).run();
    await putLeasedObject(env, { r2Key, body: body.buffer, mimeType: "text/html", sha256: checksum });

    await expect(putUploadFile(env, "user-a", session.uploadId, {
      path: "index.html", mimeType: "text/html", byteSize: body.byteLength, sha256: checksum,
    }, body.buffer)).resolves.toEqual({ path: "index.html", mimeType: "text/html", byteSize: body.byteLength, sha256: checksum });

    const changed = text.encode("<h1>Changed</h1>");
    await expect(putUploadFile(env, "user-a", session.uploadId, {
      path: "index.html", mimeType: "text/html", byteSize: changed.byteLength, sha256: await sha256(changed),
    }, changed.buffer)).rejects.toMatchObject({ code: "idempotency_conflict" } satisfies Partial<ArtifactError>);
  });

  it("rejects changed same-length retry bytes before recording a recovered R2 object", async () => {
    const storedBody = text.encode("<h1>First</h1>");
    const retryBody = text.encode("<h1>Other</h1>");
    expect(retryBody.byteLength).toBe(storedBody.byteLength);
    const storedChecksum = await sha256(storedBody);
    const session = await createUploadSession(env, "user-a", {
      project: { projectId: "project-a" },
      type: "html",
      title: "Recovery body validation",
      idempotencyKey: "recover-r2-body-validation",
    });
    const r2Key = artifactObjectKey(session.artifactId, session.versionId, "index.html");
    await env.DB.prepare(
      "INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(r2Key, session.uploadId, "user-a", storedBody.byteLength, storedChecksum, Date.now() + 60_000, Date.now()).run();
    await putLeasedObject(env, { r2Key, body: storedBody.buffer, mimeType: "text/html", sha256: storedChecksum });

    await expect(putUploadFile(env, "user-a", session.uploadId, {
      path: "index.html", mimeType: "text/html", byteSize: storedBody.byteLength, sha256: storedChecksum,
    }, retryBody.buffer)).rejects.toMatchObject({ code: "invalid_checksum" } satisfies Partial<ArtifactError>);

    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_upload_files WHERE upload_id = ?").bind(session.uploadId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
    await expect(env.DB.prepare("SELECT byte_size, sha256 FROM artifact_object_leases WHERE r2_key = ?").bind(r2Key).first<{ byte_size: number; sha256: string }>()).resolves.toEqual({ byte_size: storedBody.byteLength, sha256: storedChecksum });
    await expect(env.ARTIFACTS.get(r2Key).then((object) => object?.text())).resolves.toBe("<h1>First</h1>");
  });

  it("finalizes a multi-file inline seed HTML draft", async () => {
    const index = text.encode("<script src=\"app.js\"></script>");
    const script = text.encode("console.log('hello');");
    const session = await createUploadSession(env, "user-a", {
      project: { projectDraft: { title: "Multi-file draft" } },
      type: "html",
      title: "Seeded app",
      idempotencyKey: "multi-file-draft",
    });
    await putUploadFile(env, "user-a", session.uploadId, {
      path: "index.html", mimeType: "text/html", byteSize: index.byteLength, sha256: await sha256(index),
    }, index.buffer);
    await putUploadFile(env, "user-a", session.uploadId, {
      path: "app.js", mimeType: "text/javascript", byteSize: script.byteLength, sha256: await sha256(script),
    }, script.buffer);

    await expect(finalizeUpload(env, "user-a", session.uploadId)).resolves.toEqual({ artifactId: session.artifactId, versionId: session.versionId });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_files WHERE version_id = ?").bind(session.versionId).first<{ count: number }>()).resolves.toEqual({ count: 2 });
  });

  it("retains an unmanifested cleanup lease when finalizing an inline seed draft", async () => {
    const body = text.encode("<h1>Finalized</h1>");
    const session = await createUploadSession(env, "user-a", {
      project: { projectDraft: { title: "Draft with retained cleanup" } },
      type: "html",
      title: "Finalized draft",
      idempotencyKey: "retained-cleanup-lease",
    });
    await putUploadFile(env, "user-a", session.uploadId, {
      path: "index.html", mimeType: "text/html", byteSize: body.byteLength, sha256: await sha256(body),
    }, body.buffer);
    const orphanKey = artifactObjectKey(session.artifactId, session.versionId, "orphan.txt");
    await env.DB.prepare(
      "INSERT INTO artifact_object_leases (r2_key, upload_id, user_id, byte_size, sha256, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(orphanKey, session.uploadId, "user-a", 1, "a".repeat(64), Date.now() + 60_000, Date.now()).run();

    await finalizeUpload(env, "user-a", session.uploadId);

    await expect(env.DB.prepare("SELECT r2_key FROM artifact_object_leases WHERE r2_key = ?").bind(orphanKey).first<{ r2_key: string }>()).resolves.toEqual({ r2_key: orphanKey });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM artifact_object_leases WHERE upload_id = ?").bind(session.uploadId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });
});
