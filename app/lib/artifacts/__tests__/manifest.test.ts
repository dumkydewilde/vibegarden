import { describe, expect, it } from "vitest";

import { ArtifactError } from "../contracts";
import { canonicalManifest, manifestHash, mutationFingerprint } from "../validation";

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

  it("sorts paths with a locale-independent code-unit comparator", () => {
    const manifest = canonicalManifest([
      { path: "ä.txt", mimeType: "text/plain", byteSize: 1, sha256: "a".repeat(64) },
      { path: "Z.txt", mimeType: "text/plain", byteSize: 1, sha256: "b".repeat(64) },
    ]);

    expect(manifest).toMatch(/^Z\.txt\n/);
  });
});

describe("mutation fingerprints", () => {
  it("sorts object keys and normalized origins without accepting raw content", async () => {
    const first = await mutationFingerprint({
      title: "Report",
      allowedDataOrigins: ["https://B.example", "https://a.example:443"],
      files: [{ path: "index.html", mimeType: "text/html", sha256: "a".repeat(64), byteSize: 12 }],
    });
    const second = await mutationFingerprint({
      files: [{ byteSize: 12, sha256: "a".repeat(64), mimeType: "text/html", path: "index.html" }],
      allowedDataOrigins: ["https://a.example", "https://b.example"],
      title: "Report",
    });

    expect(first).toBe(second);
  });

  it.each([
    { path: "<script>alert(1)</script>", mimeType: "text/html", sha256: "a".repeat(64), byteSize: 12 },
    { path: "index.html", mimeType: "<script>alert(1)</script>", sha256: "a".repeat(64), byteSize: 12 },
    { path: "index.html", mimeType: "text/html", sha256: "<script>alert(1)</script>", byteSize: 12 },
  ])("rejects raw HTML in fingerprint file metadata: %o", async (file) => {
    await expect(mutationFingerprint({ files: [file] })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it.each([
    ["title", "a".repeat(121)],
    ["description", "a".repeat(1001)],
  ] as const)("rejects a %s over its metadata limit", async (field, value) => {
    await expect(mutationFingerprint({ [field]: value })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it.each([
    { htmlContent: "<secret>" },
    { sourceBody: "<secret>" },
    { payload: "<secret>" },
    { files: [{ path: "index.html", sha256: "a".repeat(64), byteSize: 12, payload: "<secret>" }] },
  ])("rejects unrecognized mutation fields that could contain raw content: %o", async (input) => {
    await expect(mutationFingerprint(input)).rejects.toMatchObject({ code: "invalid_input" });
  });
});
