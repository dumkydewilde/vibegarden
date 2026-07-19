import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const createUploadSession = vi.fn();
const putUploadFile = vi.fn();
const finalizeUpload = vi.fn();
const abortUpload = vi.fn();
const createLinkArtifact = vi.fn();
const createLinkArtifactVersion = vi.fn();
const updateArtifactMetadata = vi.fn();
const deleteArtifact = vi.fn();
const recoverArtifact = vi.fn();
const restoreArtifactVersion = vi.fn();
const shareArtifactVersion = vi.fn();
const unshareArtifact = vi.fn();

vi.mock("~/lib/auth.server", () => ({ requireUser }));
vi.mock("~/lib/artifacts/service.server", () => ({
  createUploadSession,
  putUploadFile,
  finalizeUpload,
  abortUpload,
  createLinkArtifact,
  createLinkArtifactVersion,
  updateArtifactMetadata,
  deleteArtifact,
  recoverArtifact,
  restoreArtifactVersion,
  shareArtifactVersion,
  unshareArtifact,
}));

vi.mock("~/lib/context", () => ({
  cloudflareContext: Symbol("cloudflare"),
}));

const context = {
  get: () => ({ env: { DB: {} } }),
};

const actionArgs = (request: Request, params: Record<string, string> = {}) => ({
  request,
  params,
  context,
}) as never;

const noServiceCalls = () => {
  for (const service of [
    createUploadSession,
    putUploadFile,
    finalizeUpload,
    abortUpload,
    createLinkArtifact,
    createLinkArtifactVersion,
    updateArtifactMetadata,
    deleteArtifact,
    recoverArtifact,
    restoreArtifactVersion,
    shareArtifactVersion,
    unshareArtifact,
  ]) {
    expect(service).not.toHaveBeenCalled();
  }
};

describe("artifact browser routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "session-user" });
  });

  it("authenticates before parsing a malformed upload JSON body", async () => {
    requireUser.mockRejectedValueOnce(new Response(null, { status: 401 }));
    const { action } = await import("../api.artifact-uploads");

    const response = await action(actionArgs(new Request("https://vibegarden.club/api/artifact-uploads", {
      method: "POST",
      body: "{",
    })));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(createUploadSession).not.toHaveBeenCalled();
  });

  it("uses the session identity and rejects a supplied user id", async () => {
    const { action } = await import("../api.artifact-uploads");
    const response = await action(actionArgs(new Request("https://vibegarden.club/api/artifact-uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "other-user" }),
    })));

    expect(response.status).toBe(400);
    expect(createUploadSession).not.toHaveBeenCalled();
  });

  it("maps malformed upload headers to a safe response before service work", async () => {
    const { action } = await import("../api.artifact-uploads.$uploadId.files");
    const response = await action(actionArgs(new Request("https://vibegarden.club/api/artifact-uploads/upload-1/files", {
      method: "PUT",
      body: "hello",
    }), { uploadId: "upload-1" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ message: expect.any(String) }));
    expect(putUploadFile).not.toHaveBeenCalled();
  });

  it("compares declared and actual upload bytes before service work", async () => {
    const { action } = await import("../api.artifact-uploads.$uploadId.files");
    const response = await action(actionArgs(new Request("https://vibegarden.club/api/artifact-uploads/upload-1/files", {
      method: "PUT",
      headers: {
        "X-Artifact-Path": "note.txt",
        "X-Artifact-Mime": "text/plain",
        "X-Artifact-Bytes": "6",
        "X-Artifact-SHA256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
      body: "hello",
    }), { uploadId: "upload-1" }));

    expect(response.status).toBe(400);
    expect(putUploadFile).not.toHaveBeenCalled();
  });

  it("passes the session identity to upload file storage and returns no sensitive fields", async () => {
    putUploadFile.mockResolvedValueOnce({
      path: "note.txt",
      mimeType: "text/plain",
      byteSize: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      r2Key: "artifacts/secret",
      lease: "secret-lease",
    });
    const { action } = await import("../api.artifact-uploads.$uploadId.files");
    const response = await action(actionArgs(new Request("https://vibegarden.club/api/artifact-uploads/upload-1/files", {
      method: "PUT",
      headers: {
        "X-Artifact-Path": "note.txt",
        "X-Artifact-Mime": "text/plain",
        "X-Artifact-Bytes": "5",
        "X-Artifact-SHA256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
      body: "hello",
    }), { uploadId: "upload-1" }));

    expect(putUploadFile).toHaveBeenCalledWith(expect.anything(), "session-user", "upload-1", expect.objectContaining({ path: "note.txt" }), expect.anything());
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(await response.json())).not.toMatch(/session-user|artifacts\/secret|secret-lease/i);
  });

  it("keeps foreign metadata writes indistinguishable and cached nowhere", async () => {
    const { ArtifactError } = await import("~/lib/artifacts/contracts");
    updateArtifactMetadata.mockRejectedValueOnce(new ArtifactError("not_found"));
    const { action } = await import("../api.artifacts.$artifactId");
    const response = await action(actionArgs(new Request("https://vibegarden.club/api/artifacts/foreign", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Changed" }),
    }), { artifactId: "foreign" }));

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(updateArtifactMetadata).toHaveBeenCalledWith(expect.anything(), "session-user", "foreign", { title: "Changed" });
  });

  it("requires the exact retained version when sharing to the gallery", async () => {
    const { action } = await import("../api.artifacts.$artifactId.gallery");
    const response = await action(actionArgs(new Request("https://vibegarden.club/api/artifacts/artifact-1/gallery", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }), { artifactId: "artifact-1" }));

    expect(response.status).toBe(400);
    expect(shareArtifactVersion).not.toHaveBeenCalled();
  });

  it.each([
    ["upload creation", "../api.artifact-uploads", "action", "/api/artifact-uploads", {}, "GET"],
    ["upload file", "../api.artifact-uploads.$uploadId.files", "action", "/api/artifact-uploads/upload-1/files", { uploadId: "upload-1" }, "POST"],
    ["upload finalization", "../api.artifact-uploads.$uploadId.finalize", "action", "/api/artifact-uploads/upload-1/finalize", { uploadId: "upload-1" }, "PUT"],
    ["upload abort", "../api.artifact-uploads.$uploadId.abort", "action", "/api/artifact-uploads/upload-1/abort", { uploadId: "upload-1" }, "DELETE"],
    ["link creation", "../api.artifacts.links", "action", "/api/artifacts/links", {}, "GET"],
    ["link version creation", "../api.artifacts.$artifactId.link-version", "action", "/api/artifacts/artifact-1/link-version", { artifactId: "artifact-1" }, "PATCH"],
    ["artifact mutations", "../api.artifacts.$artifactId", "action", "/api/artifacts/artifact-1", { artifactId: "artifact-1" }, "GET"],
    ["version restoration", "../api.artifacts.$artifactId.restore-version", "action", "/api/artifacts/artifact-1/restore-version", { artifactId: "artifact-1" }, "DELETE"],
    ["gallery mutations", "../api.artifacts.$artifactId.gallery", "action", "/api/artifacts/artifact-1/gallery", { artifactId: "artifact-1" }, "POST"],
  ])("rejects an alternate verb for %s before auth or service work", async (_name, modulePath, exportName, path, params, method) => {
    const route = await import(modulePath as string);
    const response = await route[exportName as "action"](actionArgs(new Request(`https://vibegarden.club${path}`, { method }), params as Record<string, string>));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(requireUser).not.toHaveBeenCalled();
    noServiceCalls();
  });

  it.each([
    ["upload creation", "../api.artifact-uploads", "action", "/api/artifact-uploads", {}, "POST"],
    ["upload file", "../api.artifact-uploads.$uploadId.files", "action", "/api/artifact-uploads/upload-1/files", { uploadId: "upload-1" }, "PUT"],
    ["upload finalization", "../api.artifact-uploads.$uploadId.finalize", "action", "/api/artifact-uploads/upload-1/finalize", { uploadId: "upload-1" }, "POST"],
    ["upload abort", "../api.artifact-uploads.$uploadId.abort", "action", "/api/artifact-uploads/upload-1/abort", { uploadId: "upload-1" }, "POST"],
    ["link creation", "../api.artifacts.links", "action", "/api/artifacts/links", {}, "POST"],
    ["link version creation", "../api.artifacts.$artifactId.link-version", "action", "/api/artifacts/artifact-1/link-version", { artifactId: "artifact-1" }, "POST"],
    ["artifact mutations", "../api.artifacts.$artifactId", "action", "/api/artifacts/artifact-1", { artifactId: "artifact-1" }, "POST"],
    ["version restoration", "../api.artifacts.$artifactId.restore-version", "action", "/api/artifacts/artifact-1/restore-version", { artifactId: "artifact-1" }, "POST"],
    ["gallery mutations", "../api.artifacts.$artifactId.gallery", "action", "/api/artifacts/artifact-1/gallery", { artifactId: "artifact-1" }, "PUT"],
    ["capability lookup", "../api.artifacts.$artifactId.capability", "loader", "/api/artifacts/artifact-1/capability", { artifactId: "artifact-1" }, "GET"],
  ])("adds no-store while preserving an unauthenticated redirect for %s", async (_name, modulePath, exportName, path, params, method) => {
    requireUser.mockRejectedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: "/login?next=%2Fartifacts" },
    }));
    const route = await import(modulePath as string);
    const response = await route[exportName as "action"](actionArgs(new Request(`https://vibegarden.club${path}`, { method, body: method === "GET" ? undefined : "{" }), params as Record<string, string>));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?next=%2Fartifacts");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    noServiceCalls();
  });
});
