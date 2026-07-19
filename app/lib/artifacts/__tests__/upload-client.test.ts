import { describe, expect, it, vi } from "vitest";

import type { PreparedArtifactPackage } from "../package.client";
import { uploadPreparedPackage } from "../upload.client";

const prepared: PreparedArtifactPackage = {
  type: "html",
  files: [
    { path: "index.html", mimeType: "text/html", byteSize: 2, sha256: "a".repeat(64), blob: new Blob(["ok"], { type: "text/html" }) },
    { path: "assets/app.js", mimeType: "text/javascript", byteSize: 2, sha256: "b".repeat(64), blob: new Blob(["js"], { type: "text/javascript" }) },
  ],
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("uploadPreparedPackage", () => {
  it("creates one idempotent session, streams files sequentially with exact headers, and finalizes", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ uploadId: "upload-1", artifactId: "artifact-1", versionId: "version-1", expiresAt: 1 }, 201))
      .mockResolvedValueOnce(response({ path: "index.html", byteSize: 2, sha256: "a".repeat(64) }))
      .mockResolvedValueOnce(response({ path: "assets/app.js", byteSize: 2, sha256: "b".repeat(64) }))
      .mockResolvedValueOnce(response({ artifactId: "artifact-1", versionId: "version-1" }));
    const progress = vi.fn();

    const result = await uploadPreparedPackage(prepared, {
      project: { projectId: "project-1" }, title: "Demo", allowedDataOrigins: [], idempotencyKey: "key-1", fetch: fetcher, onProgress: progress,
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/artifact-uploads", "/api/artifact-uploads/upload-1/files", "/api/artifact-uploads/upload-1/files", "/api/artifact-uploads/upload-1/finalize",
    ]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ project: { projectId: "project-1" }, type: "html", title: "Demo", allowedDataOrigins: [], idempotencyKey: "key-1" });
    for (const call of fetcher.mock.calls.slice(1, 3)) {
      expect([...new Headers(call[1].headers).keys()].sort()).toEqual(["x-artifact-bytes", "x-artifact-mime", "x-artifact-path", "x-artifact-sha256"]);
    }
    expect(progress).toHaveBeenLastCalledWith({ completedFiles: 2, completedBytes: 4, totalFiles: 2, totalBytes: 4 });
    expect(result).toMatchObject({ artifactId: "artifact-1", versionId: "version-1", resume: { uploadId: "upload-1" } });
  });

  it("returns confirmed acknowledgements after a failed upload so retrying skips the confirmed file", async () => {
    const firstAttempt = vi.fn()
      .mockResolvedValueOnce(response({ uploadId: "upload-1", artifactId: "artifact-1", versionId: "version-1", expiresAt: 1, completed: [] }, 201))
      .mockResolvedValueOnce(response({ path: "index.html", byteSize: 2, sha256: "a".repeat(64) }))
      .mockResolvedValueOnce(response({ message: "temporary failure" }, 503));

    const failure = await uploadPreparedPackage(prepared, {
      project: { projectId: "project-1" }, title: "Demo", allowedDataOrigins: [], idempotencyKey: "key-1", fetch: firstAttempt,
    }).catch((error: unknown) => error as Error & { resume?: unknown });

    expect(failure.resume).toEqual({
      uploadId: "upload-1",
      artifactId: "artifact-1",
      versionId: "version-1",
      completed: [{ path: "index.html", byteSize: 2, sha256: "a".repeat(64) }],
    });

    const retry = vi.fn()
      .mockResolvedValueOnce(response({
        uploadId: "upload-1", artifactId: "artifact-1", versionId: "version-1", expiresAt: 1,
        completed: [{ path: "index.html", byteSize: 2, sha256: "a".repeat(64) }],
      }, 201))
      .mockResolvedValueOnce(response({ path: "assets/app.js", byteSize: 2, sha256: "b".repeat(64) }))
      .mockResolvedValueOnce(response({ artifactId: "artifact-1", versionId: "version-1" }));

    await uploadPreparedPackage(prepared, {
      project: { projectId: "project-1" }, title: "Demo", allowedDataOrigins: [], idempotencyKey: "key-1", fetch: retry,
      resume: failure.resume as never,
    });

    expect(retry.mock.calls.map(([url]) => url)).toEqual([
      "/api/artifact-uploads", "/api/artifact-uploads/upload-1/files", "/api/artifact-uploads/upload-1/finalize",
    ]);
    expect(new Headers(retry.mock.calls[1][1].headers).get("X-Artifact-Path")).toBe("assets/app.js");
  });

  it("uses only matching server-confirmed acknowledgements when supplied resume state is stale", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ uploadId: "upload-2", artifactId: "artifact-2", versionId: "version-2", expiresAt: 1, completed: [] }, 201))
      .mockResolvedValueOnce(response({ path: "index.html", byteSize: 2, sha256: "a".repeat(64) }))
      .mockResolvedValueOnce(response({ path: "assets/app.js", byteSize: 2, sha256: "b".repeat(64) }))
      .mockResolvedValueOnce(response({ artifactId: "artifact-2", versionId: "version-2" }));

    await uploadPreparedPackage(prepared, {
      project: { projectId: "project-1" }, title: "Demo", allowedDataOrigins: [], idempotencyKey: "key-1", fetch: fetcher,
      resume: { uploadId: "upload-1", artifactId: "artifact-1", versionId: "version-1", completed: [{ path: "index.html", byteSize: 2, sha256: "a".repeat(64) }] },
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/artifact-uploads", "/api/artifact-uploads/upload-2/files", "/api/artifact-uploads/upload-2/files", "/api/artifact-uploads/upload-2/finalize",
    ]);
  });

  it("aborts the server upload when its AbortSignal fires", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ uploadId: "upload-1", artifactId: "artifact-1", versionId: "version-1", expiresAt: 1 }, 201))
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      })
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(uploadPreparedPackage(prepared, {
      project: { projectId: "project-1" }, title: "Demo", allowedDataOrigins: [], idempotencyKey: "key-1", fetch: fetcher, signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(fetcher.mock.calls.map(([url]) => url)).toContain("/api/artifact-uploads/upload-1/abort");
  });
});
