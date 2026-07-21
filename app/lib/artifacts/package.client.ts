import { BlobReader, BlobWriter, ZipReader, type Entry } from "@zip.js/zip.js";

import { ArtifactError, type ArtifactPackageFile, type ArtifactType } from "./contracts";
import {
  HTML_PACKAGE_MIME_BY_EXTENSION,
  SAFE_DOWNLOAD_MIME_BY_EXTENSION,
  inspectArtifactContent,
  normalizeArtifactOrigin,
  normalizeArtifactPath,
  validateArtifactPackage,
  validateZipArtifactEntry,
} from "./validation";

export type PreparedArtifactFile = {
  path: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  blob: Blob;
};

export type PreparedArtifactPackage = {
  type: Exclude<ArtifactType, "link">;
  files: PreparedArtifactFile[];
};

type NamedBlob = Blob & { name?: string };
type InspectedZipEntry = { entry: Extract<Entry, { directory: false }>; path: string; mimeType: string; byteSize: number; zipUnixMode?: number };

function artifactError(code: ConstructorParameters<typeof ArtifactError>[0]): never {
  throw new ArtifactError(code);
}

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

function mimeFor(path: string, type: Exclude<ArtifactType, "link">): string {
  const mime = (type === "html" ? HTML_PACKAGE_MIME_BY_EXTENSION : SAFE_DOWNLOAD_MIME_BY_EXTENSION)[extension(path) as keyof typeof HTML_PACKAGE_MIME_BY_EXTENSION];
  return mime ?? artifactError("invalid_manifest");
}

function typeForFilename(filename: string): Exclude<ArtifactType, "link"> {
  return [".html", ".htm"].includes(extension(filename)) ? "html" : "file";
}

function sanitizedBasename(name: string): string {
  const base = name.split(/[\\/]/u).filter(Boolean).at(-1) ?? "";
  return normalizeArtifactPath(base);
}

function assertSafeSize(size: number): number {
  if (!Number.isSafeInteger(size) || size < 0) artifactError("invalid_manifest");
  return size;
}

function unixMode(entry: Entry): number | undefined {
  if (entry.unixMode !== undefined) return entry.unixMode;
  // Zip.js intentionally leaves unixMode undefined for some creator platforms,
  // even when the authoritative external attribute contains Unix type bits.
  const upper = entry.externalFileAttributes >>> 16;
  return upper === 0 ? undefined : upper;
}

function validateZipDirectory(path: string, mode: number | undefined): string {
  if (mode !== undefined) {
    if (!Number.isSafeInteger(mode)) artifactError("invalid_manifest");
    const type = mode & 0o170000;
    if (type !== 0 && type !== 0o040000) artifactError("invalid_manifest");
  }
  return normalizeArtifactPath(path);
}

/** Inspects ZIP central-directory metadata and validates every entry before body extraction. */
async function inspectZip(zip: Blob): Promise<{ type: "html"; entries: InspectedZipEntry[] }> {
  const reader = new ZipReader(new BlobReader(zip));
  try {
    const entries = await reader.getEntries();
    const files: InspectedZipEntry[] = [];
    const paths = new Set<string>();

    for (const entry of entries) {
      const rawPath = entry.filename;
      if (entry.directory) {
        const directoryPath = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
        if (!directoryPath) artifactError("invalid_manifest");
        const path = validateZipDirectory(directoryPath, unixMode(entry));
        if (paths.has(path)) artifactError("invalid_manifest");
        paths.add(path);
        continue;
      }

      if (entry.encrypted) artifactError("invalid_manifest");
      const path = validateZipArtifactEntry({
        path: rawPath,
        zipIsDirectory: false,
        zipUnixMode: unixMode(entry),
      });
      if (paths.has(path)) artifactError("invalid_manifest");
      paths.add(path);
      files.push({ entry, path, mimeType: mimeFor(path, "html"), byteSize: assertSafeSize(entry.uncompressedSize), zipUnixMode: unixMode(entry) });
    }

    // This applies count and byte limits while every entry is still metadata only.
    validateArtifactPackage({
      type: "html",
      source: "browser",
      files: files.map(({ path, mimeType, byteSize, zipUnixMode }) => ({ path, mimeType, byteSize, zipUnixMode })),
    });
    return { type: "html", entries: files };
  } finally {
    await reader.close();
  }
}

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function prepareFiles(type: Exclude<ArtifactType, "link">, files: readonly { path: string; mimeType: string; blob: Blob; zipUnixMode?: number }[]): Promise<PreparedArtifactPackage> {
  const prepared: PreparedArtifactFile[] = [];
  for (const file of files) {
    const content = new Uint8Array(await file.blob.arrayBuffer());
    const candidate: ArtifactPackageFile = {
      path: file.path,
      mimeType: file.mimeType,
      byteSize: content.byteLength,
      content,
      zipUnixMode: file.zipUnixMode,
    };
    inspectArtifactContent(candidate);
    prepared.push({ ...file, byteSize: content.byteLength, sha256: await hashBlob(file.blob) });
  }
  validateArtifactPackage({
    type,
    source: "browser",
    files: prepared.map(({ path, mimeType, byteSize, sha256 }) => ({ path, mimeType, byteSize, sha256 })),
  });
  return { type, files: prepared };
}

async function prepareZip(selection: Blob): Promise<PreparedArtifactPackage> {
  const inspected = await inspectZip(selection);
  const extracted: { path: string; mimeType: string; blob: Blob; zipUnixMode?: number }[] = [];
  // Extraction intentionally stays sequential, after the complete metadata pass above.
  for (const file of inspected.entries) {
    const blob = await file.entry.getData(new BlobWriter(file.mimeType));
    extracted.push({ path: file.path, mimeType: file.mimeType, blob, zipUnixMode: file.zipUnixMode });
  }
  return prepareFiles(inspected.type, extracted);
}

/** Converts a browser-selected HTML, ZIP package, or safe download into an upload-ready manifest. */
export async function prepareArtifactSelection(selection: NamedBlob): Promise<PreparedArtifactPackage> {
  if (!(selection instanceof Blob) || typeof selection.name !== "string" || !selection.name) artifactError("invalid_input");
  const filename = sanitizedBasename(selection.name);
  if (extension(filename) === ".zip") return prepareZip(selection);

  const type = typeForFilename(filename);
  const path = type === "html" ? "index.html" : filename;
  return prepareFiles(type, [{ path, mimeType: mimeFor(path, type), blob: selection }]);
}

/** Finds literal HTTPS origins for owner review. Returned values are suggestions only. */
export function suggestDataOrigins(content: string): string[] {
  if (typeof content !== "string") return [];
  const origins = new Set<string>();
  for (const match of content.matchAll(/https:\/\/[^\s"'<>`\\)]+/gu)) {
    try {
      origins.add(normalizeArtifactOrigin(new URL(match[0]).origin));
    } catch {
      // Suggestions are advisory; malformed URLs are not carried into an approval field.
    }
  }
  return [...origins].sort();
}
