import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const createUploadSession = vi.fn();
const putUploadFile = vi.fn();
const updateArtifactMetadata = vi.fn();
const shareArtifactVersion = vi.fn();

vi.mock("~/lib/auth.server", () => ({ requireUser }));
vi.mock("~/lib/artifacts/service.server", () => ({
  createUploadSession,
  putUploadFile,
  updateArtifactMetadata,
  shareArtifactVersion,
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

describe("artifact browser routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "session-user" });
  });

  it("authenticates before parsing a malformed upload JSON body", async () => {
    requireUser.mockRejectedValueOnce(new Response(null, { status: 401 }));
    const { action } = await import("../api.artifact-uploads");

    await expect(action(actionArgs(new Request("https://vibegarden.club/api/artifact-uploads", {
      method: "POST",
      body: "{",
    })))).rejects.toMatchObject({ status: 401 });

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
});
