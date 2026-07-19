import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ArtifactError } from "../../app/lib/artifacts/contracts";
import {
  artifactObjectKey,
  getVersionObject,
  putLeasedObject,
} from "../../app/lib/artifacts/object-store.server";

const SHA256_HELLO = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("private artifact object store", () => {
  it("uses an immutable artifact/version prefix and refuses escaping paths", () => {
    expect(artifactObjectKey("artifact-1", "version-1", "assets/app.js")).toBe(
      "artifacts/artifact-1/versions/version-1/assets/app.js",
    );
    expect(() => artifactObjectKey("artifact-1", "version-1", "../secret.txt")).toThrow(
      ArtifactError,
    );
  });

  it("rejects a declared SHA-256 that does not match the uploaded object", async () => {
    await expect(
      putLeasedObject(env, {
        r2Key: artifactObjectKey("artifact-checksum", "version-1", "index.html"),
        body: "hello",
        mimeType: "text/html",
        sha256: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "invalid_checksum" });
  });

  it("stores MIME in HTTP metadata only and exposes no uploaded source metadata", async () => {
    const key = artifactObjectKey("artifact-metadata", "version-1", "index.html");
    await putLeasedObject(env, {
      r2Key: key,
      body: "hello",
      mimeType: "text/html",
      sha256: SHA256_HELLO,
    });

    const stored = await env.ARTIFACTS.head(key);
    expect(stored?.httpMetadata).toEqual({ contentType: "text/html" });
    expect(stored?.customMetadata).not.toHaveProperty("source");
    expect(await getVersionObject(env, "artifacts/artifact-metadata/versions/version-1", "index.html")).not.toBeNull();
    await expect(
      getVersionObject(env, "artifacts/artifact-metadata/versions/version-1", "../secret.txt"),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("rejects attempts to overwrite an immutable artifact object key", async () => {
    const key = artifactObjectKey("artifact-create-only", "version-1", "index.html");
    await putLeasedObject(env, {
      r2Key: key,
      body: "hello",
      mimeType: "text/html",
      sha256: SHA256_HELLO,
    });

    await expect(
      putLeasedObject(env, {
        r2Key: key,
        body: "goodbye",
        mimeType: "text/html",
        sha256: "82e35a63ceba37e9646434c5dd412ea577147f1e4a41ccde1614253187e3dbf9",
      }),
    ).rejects.toMatchObject({ code: "state_conflict" });

    await expect((await env.ARTIFACTS.get(key))?.text()).resolves.toBe("hello");
  });
});
