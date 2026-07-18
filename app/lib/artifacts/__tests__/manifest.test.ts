import { describe, expect, it } from "vitest";

import { ArtifactError } from "../contracts";
import { manifestHash, mutationFingerprint } from "../validation";

describe("artifact manifests", () => {
  const files = [
    { path: "z.js", mimeType: "text/javascript", byteSize: 4, sha256: "B".repeat(64) },
    { path: "index.html", mimeType: "text/html", byteSize: 5, sha256: "A".repeat(64) },
  ];

  it("hashes manifest entries in normalized path order with lowercase checksums", async () => {
    const first = await manifestHash(files);
    const second = await manifestHash([...files].reverse());

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an invalid manifest checksum", async () => {
    await expect(
      manifestHash([{ path: "index.html", mimeType: "text/html", byteSize: 1, sha256: "not-a-checksum" }]),
    ).rejects.toMatchObject({ code: "invalid_checksum" } satisfies Partial<ArtifactError>);
  });

  it("rejects manifest paths that collide after NFC normalization", async () => {
    await expect(
      manifestHash([
        { path: "café.txt", mimeType: "text/plain", byteSize: 1, sha256: "a".repeat(64) },
        { path: "café.txt", mimeType: "text/plain", byteSize: 1, sha256: "b".repeat(64) },
      ]),
    ).rejects.toMatchObject({ code: "invalid_manifest" } satisfies Partial<ArtifactError>);
  });
});

describe("mutation fingerprints", () => {
  it("sorts object keys and normalized origins without accepting raw content", async () => {
    const first = await mutationFingerprint({
      title: "Report",
      allowedDataOrigins: ["https://B.example", "https://a.example:443"],
      files: [{ path: "index.html", sha256: "a".repeat(64), byteSize: 12 }],
    });
    const second = await mutationFingerprint({
      files: [{ byteSize: 12, sha256: "a".repeat(64), path: "index.html" }],
      allowedDataOrigins: ["https://a.example", "https://b.example"],
      title: "Report",
    });

    expect(first).toBe(second);
  });

  it("rejects a raw-content mutation field", async () => {
    await expect(mutationFingerprint({ content: "<secret>" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});
