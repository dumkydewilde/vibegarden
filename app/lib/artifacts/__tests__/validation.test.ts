import { describe, expect, it } from "vitest";

import {
  ARTIFACT_LIMITS,
  ArtifactError,
} from "../contracts";
import {
  HTML_PACKAGE_MIME_BY_EXTENSION,
  SAFE_DOWNLOAD_MIME_BY_EXTENSION,
  inspectArtifactContent,
  assertUtf8Stream,
  normalizeArtifactLink,
  normalizeArtifactOrigins,
  normalizeArtifactPath,
  validateArtifactPackage,
  validateZipArtifactEntry,
} from "../validation";

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value);

function expectCode(action: () => unknown, code: string) {
  expect(action).toThrow(ArtifactError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("artifact paths", () => {
  it.each([
    ["café/index.html", "café/index.html"],
    ["nested/index.html", "nested/index.html"],
  ])("normalizes %s to NFC", (input, expected) => {
    expect(normalizeArtifactPath(input)).toBe(expected);
  });

  it.each([
    ["", "invalid_path"],
    ["/index.html", "invalid_path"],
    ["../index.html", "invalid_path"],
    ["nested/../index.html", "invalid_path"],
    ["nested//index.html", "invalid_path"],
    ["nested\\index.html", "invalid_path"],
    ["C:/artifact/index.html", "invalid_path"],
    ["C:artifact/index.html", "invalid_path"],
    ["nested/\uD800index.html", "invalid_path"],
    ["nested/\uDC00index.html", "invalid_path"],
    ["nested/\u0000index.html", "invalid_path"],
    [".DS_Store", "invalid_path"],
    ["__MACOSX/index.html", "invalid_path"],
  ])("rejects unsafe path %j", (path, code) => {
    expectCode(() => normalizeArtifactPath(path), code);
  });

  it("enforces UTF-8 path and segment byte limits", () => {
    expect(normalizeArtifactPath("a".repeat(ARTIFACT_LIMITS.segmentBytes))).toHaveLength(
      ARTIFACT_LIMITS.segmentBytes,
    );
    expectCode(
      () => normalizeArtifactPath("a".repeat(ARTIFACT_LIMITS.segmentBytes + 1)),
      "invalid_path",
    );
    expectCode(
      () => normalizeArtifactPath(`a/${"b".repeat(ARTIFACT_LIMITS.pathBytes)}`),
      "invalid_path",
    );
  });
});

describe("public artifact errors", () => {
  it("projects only the safe message, status, and retryability", () => {
    expect(new ArtifactError("storage_unavailable").toPublic()).toEqual({
      message: "Artifact storage is temporarily unavailable.",
      status: 503,
      retryable: true,
    });
  });
});

describe("artifact packages", () => {
  it("rejects a null ZIP entry with a stable artifact error", () => {
    expectCode(
      () => validateZipArtifactEntry(null as unknown as { path: string }),
      "invalid_manifest",
    );
  });

  it.each([null, "not an artifact file"]) (
    "rejects a non-object file entry: %o",
    (file) => {
      expectCode(
        () => validateArtifactPackage({
          type: "html",
          source: "browser",
          files: [file] as unknown as { path: string; mimeType: string; byteSize: number }[],
        }),
        "invalid_manifest",
      );
    },
  );

  it("rejects symlink and special ZIP entries before their bodies are read", () => {
    expect(validateZipArtifactEntry({ path: "index.html", zipUnixMode: 0o100644 })).toBe("index.html");
    expectCode(
      () => validateZipArtifactEntry({ path: "linked.html", zipUnixMode: 0o120777 }),
      "invalid_manifest",
    );
  });

  it.each([Symbol("mode"), 0o100644n, "0o100644", Number.POSITIVE_INFINITY, 0o100644 + 0.5])(
    "rejects a non-integral ZIP Unix mode before applying a bitwise mask: %s",
    (zipUnixMode) => {
      expectCode(
        () => validateZipArtifactEntry({
          path: "index.html",
          zipUnixMode: zipUnixMode as unknown as number,
        }),
        "invalid_manifest",
      );
    },
  );

  it.each([
    ["html", "index.html", "text/html"],
    ["html", "assets/app.js", "text/javascript"],
    ["file", "report.pdf", "application/pdf"],
  ] as const)("accepts the mapped %s extension and MIME", (type, path, mimeType) => {
    expect(() =>
      validateArtifactPackage({
        type,
        source: "browser",
        files: [
          ...(type === "html" && path !== "index.html"
            ? [{ path: "index.html", mimeType: "text/html", byteSize: 1 }]
            : []),
          { path, mimeType, byteSize: 1 },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    ["html package needs root index", { type: "html", source: "browser", files: [{ path: "nested/index.html", mimeType: "text/html", byteSize: 1 }] }],
    ["normalized paths cannot collide", { type: "html", source: "browser", files: [{ path: "index.html", mimeType: "text/html", byteSize: 1 }, { path: "café.js", mimeType: "text/javascript", byteSize: 1 }, { path: "café.js", mimeType: "text/javascript", byteSize: 1 }] }],
    ["file download must have one file", { type: "file", source: "browser", files: [{ path: "one.txt", mimeType: "text/plain", byteSize: 1 }, { path: "two.txt", mimeType: "text/plain", byteSize: 1 }] }],
    ["extension and MIME must match", { type: "file", source: "browser", files: [{ path: "report.pdf", mimeType: "text/plain", byteSize: 1 }] }],
    ["MCP packages have a smaller file limit", { type: "html", source: "mcp", files: Array.from({ length: ARTIFACT_LIMITS.mcpFiles + 1 }, (_, index) => ({ path: index === 0 ? "index.html" : `f${index}.js`, mimeType: index === 0 ? "text/html" : "text/javascript", byteSize: 1 })) }],
  ])("rejects %s", (name, input) => {
    expectCode(
      () => validateArtifactPackage(input),
      name === "MCP packages have a smaller file limit" ? "limit_exceeded" : "invalid_manifest",
    );
  });

  it("enforces browser ordinary and aggregate byte limits", () => {
    expectCode(
      () => validateArtifactPackage({ type: "file", source: "browser", files: [{ path: "report.pdf", mimeType: "application/pdf", byteSize: ARTIFACT_LIMITS.ordinaryFileBytes + 1 }] }),
      "limit_exceeded",
    );
    expectCode(
      () => validateArtifactPackage({ type: "html", source: "browser", files: [{ path: "index.html", mimeType: "text/html", byteSize: 1 }, { path: "data.parquet", mimeType: "application/vnd.apache.parquet", byteSize: ARTIFACT_LIMITS.browserBytes }] }),
      "limit_exceeded",
    );
  });

  it.each([null, false, 0, ""])("rejects supplied non-binary content: %p", (content) => {
    expectCode(
      () => validateArtifactPackage({
        type: "file",
        source: "browser",
        files: [{ path: "empty.txt", mimeType: "text/plain", byteSize: 0, content: content as unknown as Uint8Array }],
      }),
      "invalid_manifest",
    );
  });

  it("accepts a supplied empty Uint8Array", () => {
    expect(() =>
      validateArtifactPackage({
        type: "file",
        source: "browser",
        files: [{ path: "empty.txt", mimeType: "text/plain", byteSize: 0, content: new Uint8Array() }],
      }),
    ).not.toThrow();
  });
});

describe("content inspection", () => {
  it("rejects a null content-inspection input with a stable artifact error", () => {
    expectCode(
      () => inspectArtifactContent(null as unknown as { path: string; mimeType: string }),
      "invalid_input",
    );
  });

  it.each([
    ["null", null],
    ["an indexed byteLength lookalike", { 0: 0x89, 1: 0x50, byteLength: 8 }],
  ])("rejects %s content before binary inspection", (_name, content) => {
    expectCode(
      () => inspectArtifactContent({
        path: "image.png",
        mimeType: "image/png",
        content: content as unknown as Uint8Array,
      }),
      "invalid_input",
    );
  });

  it.each([
    ["image.png", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff])],
    ["report.pdf", "application/pdf", bytes("%PDF-1.7")],
    ["bundle.zip", "application/zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
    ["data.gz", "application/gzip", new Uint8Array([0x1f, 0x8b, 0x08])],
    ["data.parquet", "application/vnd.apache.parquet", bytes("PAR1dataPAR1")],
    ["module.wasm", "application/wasm", new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])],
  ] as const)("accepts a valid %s signature", (path, mimeType, content) => {
    expect(() => inspectArtifactContent({ path, mimeType, content })).not.toThrow();
  });

  it.each([
    ["image.png", "image/png", bytes("not a PNG")],
    ["text.txt", "text/plain", new Uint8Array([0xc3, 0x28])],
    ["data.parquet", "application/vnd.apache.parquet", bytes("PAR1data")],
  ])("rejects invalid content for %s", (path, mimeType, content) => {
    expectCode(() => inspectArtifactContent({ path, mimeType, content }), "invalid_type");
  });

  it("stream-decodes UTF-8 text with fatal decoding", async () => {
    const valid = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes("caf"));
        controller.enqueue(new Uint8Array([0xc3, 0xa9]));
        controller.close();
      },
    });
    await expect(assertUtf8Stream(valid)).resolves.toBeUndefined();

    const invalid = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xc3, 0x28]));
        controller.close();
      },
    });
    await expect(assertUtf8Stream(invalid)).rejects.toMatchObject({ code: "invalid_type" });
  });

  it("rejects a null UTF-8 stream with a stable artifact error", async () => {
    await expect(assertUtf8Stream(null as unknown as ReadableStream<Uint8Array>)).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("rejects a null UTF-8 stream reader with a stable artifact error", async () => {
    const stream = {
      getReader: () => null,
    } as unknown as ReadableStream<Uint8Array>;

    await expect(assertUtf8Stream(stream)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("translates a getReader exception to a stable artifact error", async () => {
    const stream = {
      getReader: () => {
        throw new Error("reader construction failed");
      },
    } as unknown as ReadableStream<Uint8Array>;

    await expect(assertUtf8Stream(stream)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects a UTF-8 stream reader without releaseLock before reading", async () => {
    const stream = {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
      }),
    } as unknown as ReadableStream<Uint8Array>;

    await expect(assertUtf8Stream(stream)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("does not let a broken UTF-8 stream reader cleanup mask decoding failure", async () => {
    const stream = {
      getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array([0xc3, 0x28]) }),
        releaseLock: () => {
          throw new Error("cleanup failed");
        },
      }),
    } as unknown as ReadableStream<Uint8Array>;

    await expect(assertUtf8Stream(stream)).rejects.toMatchObject({ code: "invalid_type" });
  });
});

describe("artifact URLs and origins", () => {
  it("allows HTTPS links and removes a default port", () => {
    expect(normalizeArtifactLink("https://Example.COM:443/report?q=1")).toBe(
      "https://example.com/report?q=1",
    );
  });

  it.each(["http://example.com", "https://user@example.com"]) (
    "rejects unsafe link %s",
    (value) => expectCode(() => normalizeArtifactLink(value), "invalid_input"),
  );

  it("normalizes, sorts, and deduplicates exact HTTPS origins", () => {
    expect(
      normalizeArtifactOrigins([
        "https://B.example",
        "https://a.example:443",
        "https://a.example",
      ]),
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it.each([
    "http://data.example",
    "https://user@data.example",
    "https://data.example/path",
    "https://data.example?query=1",
    "https://data.example#fragment",
    "https://*.example",
  ])("rejects a non-exact data origin %s", (value) => {
    expectCode(() => normalizeArtifactOrigins([value]), "invalid_origin");
  });

  it("caps confirmed data origins", () => {
    expectCode(
      () => normalizeArtifactOrigins(Array.from({ length: ARTIFACT_LIMITS.origins + 1 }, (_, index) => `https://${index}.example`)),
      "limit_exceeded",
    );
  });
});

describe("explicit MIME maps", () => {
  it("keeps HTML-package and download allowlists separate", () => {
    expect(HTML_PACKAGE_MIME_BY_EXTENSION[".html"]).toBe("text/html");
    expect(SAFE_DOWNLOAD_MIME_BY_EXTENSION[".pdf"]).toBe("application/pdf");
    expect(SAFE_DOWNLOAD_MIME_BY_EXTENSION[".exe"]).toBeUndefined();
  });
});
