import { BlobReader, BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { ArtifactError, ARTIFACT_LIMITS } from "../contracts";
import { prepareArtifactSelection, suggestDataOrigins } from "../package.client";

async function zip(
  files: readonly { name: string; contents?: string; options?: Record<string, unknown> }[],
): Promise<File> {
  const writer = new ZipWriter(new BlobWriter());
  for (const file of files) {
    await writer.add(file.name, new TextReader(file.contents ?? ""), file.options);
  }
  return new File([await writer.close()], "package.zip", { type: "application/zip" });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code } satisfies Partial<ArtifactError>);
}

describe("prepareArtifactSelection", () => {
  it("prepares root HTML and nested assets after inspecting the ZIP", async () => {
    const prepared = await prepareArtifactSelection(await zip([
      { name: "index.html", contents: '<script src="assets/app.js"></script>' },
      { name: "assets/app.js", contents: "console.log('ok')" },
    ]));

    expect(prepared.type).toBe("html");
    expect(prepared.files.map((file) => [file.path, file.mimeType, file.byteSize])).toEqual([
      ["index.html", "text/html", 37],
      ["assets/app.js", "text/javascript", 17],
    ]);
    expect(prepared.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
  });

  it("rejects traversal and NFC-colliding ZIP paths before extracting their bodies", async () => {
    await expectCode(prepareArtifactSelection(await zip([
      { name: "index.html", contents: "ok" },
      { name: "../escape.js", contents: "no" },
    ])), "invalid_path");
    await expectCode(prepareArtifactSelection(await zip([
      { name: "index.html", contents: "ok" },
      { name: "cafe\u0301.js", contents: "one" },
      { name: "caf\u00e9.js", contents: "two" },
    ])), "invalid_manifest");
  });

  it("rejects platform metadata, symlinks, and special files before extraction", async () => {
    await expectCode(prepareArtifactSelection(await zip([
      { name: "index.html", contents: "ok", options: { unixMode: 0o120777 } },
    ])), "invalid_manifest");
    await expectCode(prepareArtifactSelection(await zip([
      { name: "index.html", contents: "ok", options: { externalFileAttributes: 0o020000 << 16 } },
    ])), "invalid_manifest");
    await expectCode(prepareArtifactSelection(await zip([
      { name: "assets/", options: { directory: true, unixMode: 0o120777 } },
      { name: "index.html", contents: "ok" },
    ])), "invalid_manifest");
  });

  it("rejects a ZIP without a root index and one with too many files", async () => {
    await expectCode(prepareArtifactSelection(await zip([{ name: "nested/index.html", contents: "ok" }])), "invalid_manifest");
    await expectCode(prepareArtifactSelection(await zip(Array.from(
      { length: ARTIFACT_LIMITS.browserFiles + 1 },
      (_, index) => ({ name: index === 0 ? "index.html" : `assets/${index}.js`, contents: "" }),
    ))), "limit_exceeded");
  });

  it("rejects ordinary and aggregate declared ZIP overflows before extraction", async () => {
    await expectCode(prepareArtifactSelection(await zip([
      { name: "index.html", contents: "x".repeat(ARTIFACT_LIMITS.ordinaryFileBytes + 1) },
    ])), "limit_exceeded");
    await expectCode(prepareArtifactSelection(await zip([
      { name: "index.html", contents: "ok" },
      { name: "data.parquet", contents: `PAR1${"x".repeat(ARTIFACT_LIMITS.browserBytes)}PAR1` },
    ])), "limit_exceeded");
  }, 30_000);

  it("maps a single HTML file to index.html and preserves a safe download basename", async () => {
    const html = await prepareArtifactSelection(new File(["<h1>Hello</h1>"], "landing.HTML", { type: "text/html" }));
    const file = await prepareArtifactSelection(new File(["note"], "Quarterly notes.txt", { type: "text/plain" }));

    expect(html).toMatchObject({ type: "html", files: [{ path: "index.html", mimeType: "text/html" }] });
    expect(file).toMatchObject({ type: "file", files: [{ path: "Quarterly notes.txt", mimeType: "text/plain" }] });
  });
});

describe("suggestDataOrigins", () => {
  it("returns HTTPS URL origins as unchecked suggestions, never approved origins", () => {
    const suggestions = suggestDataOrigins('<script src="https://cdn.example.test/app.js"></script><img src="https://images.example.test/a.png">');

    expect(suggestions).toEqual(["https://cdn.example.test", "https://images.example.test"]);
    expect(suggestions).not.toHaveProperty("allowedDataOrigins");
  });
});
