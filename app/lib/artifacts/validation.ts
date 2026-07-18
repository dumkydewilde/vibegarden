import {
  ARTIFACT_LIMITS,
  ArtifactError,
  type ArtifactManifestFile,
  type ArtifactPackageFile,
  type ArtifactPackageInput,
  type ValidatedArtifactFile,
} from "./contracts";

export const HTML_PACKAGE_MIME_BY_EXTENSION = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".parquet": "application/vnd.apache.parquet",
  ".wasm": "application/wasm",
} as const;

export const SAFE_DOWNLOAD_MIME_BY_EXTENSION = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".parquet": "application/vnd.apache.parquet",
} as const;

export const STATIC_DEPENDENCY_ORIGINS = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
] as const;

type MimeMap = Record<string, string>;
const encoder = new TextEncoder();
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA256 = /^[a-fA-F0-9]{64}$/;
const DATA_OR_MEDIA_MIME = /^(?:audio|video)\//u;
const DATA_MIME_TYPES = new Set([
  "application/json",
  "application/vnd.apache.parquet",
  "text/csv",
  "text/tab-separated-values",
]);
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "image/svg+xml",
]);

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function extensionFor(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

function mimeFor(path: string, mimeMap: MimeMap): string | undefined {
  return mimeMap[extensionFor(path)];
}

function throwArtifact(code: ConstructorParameters<typeof ArtifactError>[0]): never {
  throw new ArtifactError(code);
}

export function normalizeArtifactPath(input: string): string {
  if (typeof input !== "string" || !input || input.includes("\\") || CONTROL_CHARACTERS.test(input)) {
    return throwArtifact("invalid_path");
  }

  const path = input.normalize("NFC");
  if (path.startsWith("/") || utf8ByteLength(path) > ARTIFACT_LIMITS.pathBytes) {
    return throwArtifact("invalid_path");
  }

  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || utf8ByteLength(segment) > ARTIFACT_LIMITS.segmentBytes)) {
    return throwArtifact("invalid_path");
  }
  if (segments.some((segment) => segment === ".DS_Store" || segment === "__MACOSX")) {
    return throwArtifact("invalid_path");
  }

  return path;
}

/** Validates ZIP metadata before any entry body is extracted. */
export function validateZipArtifactEntry(file: Pick<ArtifactPackageFile, "path" | "zipUnixMode" | "zipIsDirectory">): string {
  if (file.zipIsDirectory) return throwArtifact("invalid_manifest");
  if (file.zipUnixMode !== undefined) {
    const fileType = file.zipUnixMode & 0o170000;
    if (fileType !== 0 && fileType !== 0o100000) return throwArtifact("invalid_manifest");
  }
  return normalizeArtifactPath(file.path);
}

function validateMime(path: string, mimeType: string, mimeMap: MimeMap): void {
  if (mimeFor(path, mimeMap) !== mimeType) throwArtifact("invalid_manifest");
}

function isExtendedDataOrMedia(file: ValidatedArtifactFile): boolean {
  return DATA_MIME_TYPES.has(file.mimeType) || DATA_OR_MEDIA_MIME.test(file.mimeType);
}

export function validateArtifactPackage(input: ArtifactPackageInput): ValidatedArtifactFile[] {
  if (!input || (input.source !== "browser" && input.source !== "mcp") || !Array.isArray(input.files) || input.files.length === 0) {
    return throwArtifact("invalid_manifest");
  }
  if (input.type !== "html" && input.type !== "file") return throwArtifact("invalid_manifest");

  const maxFiles = input.source === "mcp" ? ARTIFACT_LIMITS.mcpFiles : ARTIFACT_LIMITS.browserFiles;
  if (input.files.length > maxFiles) return throwArtifact("limit_exceeded");

  const seen = new Set<string>();
  const files = input.files.map((file) => {
    if (!Number.isSafeInteger(file.byteSize) || file.byteSize < 0 || typeof file.mimeType !== "string") {
      return throwArtifact("invalid_manifest");
    }
    const path = validateZipArtifactEntry(file);
    if (seen.has(path)) return throwArtifact("invalid_manifest");
    seen.add(path);
    const validated = { ...file, path };
    validateMime(path, file.mimeType, input.type === "html" ? HTML_PACKAGE_MIME_BY_EXTENSION : SAFE_DOWNLOAD_MIME_BY_EXTENSION);
    if (file.content && file.content.byteLength !== file.byteSize) return throwArtifact("invalid_manifest");
    if (file.content) inspectArtifactContent(validated);
    return validated;
  });

  if (input.type === "html" && !seen.has("index.html")) return throwArtifact("invalid_manifest");
  if (input.type === "file" && files.length !== 1) return throwArtifact("invalid_manifest");

  const byteSize = files.reduce((total, file) => total + file.byteSize, 0);
  if (input.source === "mcp") {
    if (byteSize > ARTIFACT_LIMITS.mcpBytes) return throwArtifact("limit_exceeded");
    return files;
  }

  if (byteSize > ARTIFACT_LIMITS.browserBytes) return throwArtifact("limit_exceeded");
  const extendedFiles = files.filter(isExtendedDataOrMedia);
  if (extendedFiles.length > 1) return throwArtifact("limit_exceeded");
  if (files.some((file) => file.byteSize > ARTIFACT_LIMITS.ordinaryFileBytes && !isExtendedDataOrMedia(file))) {
    return throwArtifact("limit_exceeded");
  }
  return files;
}

function hasPrefix(content: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => content[index] === byte);
}

function assertBinarySignature(mimeType: string, content: Uint8Array): void {
  const valid =
    (mimeType === "image/png" && hasPrefix(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === "image/jpeg" && hasPrefix(content, [0xff, 0xd8, 0xff])) ||
    (mimeType === "application/pdf" && hasPrefix(content, [0x25, 0x50, 0x44, 0x46, 0x2d])) ||
    (mimeType === "application/zip" && (hasPrefix(content, [0x50, 0x4b, 0x03, 0x04]) || hasPrefix(content, [0x50, 0x4b, 0x05, 0x06]) || hasPrefix(content, [0x50, 0x4b, 0x07, 0x08]))) ||
    (mimeType === "application/gzip" && hasPrefix(content, [0x1f, 0x8b, 0x08])) ||
    (mimeType === "application/wasm" && hasPrefix(content, [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])) ||
    (mimeType === "application/vnd.apache.parquet" && hasPrefix(content, [0x50, 0x41, 0x52, 0x31]) && hasPrefix(content.slice(-4), [0x50, 0x41, 0x52, 0x31]));
  const needsSignature = new Set([
    "image/png", "image/jpeg", "application/pdf", "application/zip", "application/gzip", "application/wasm", "application/vnd.apache.parquet",
  ]).has(mimeType);
  if (needsSignature && !valid) throwArtifact("invalid_type");
}

function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType);
}

export function inspectArtifactContent(input: Pick<ArtifactPackageFile, "path" | "mimeType" | "content">): void {
  if (!input.content) throwArtifact("invalid_input");
  const expectedMime = mimeFor(normalizeArtifactPath(input.path), {
    ...HTML_PACKAGE_MIME_BY_EXTENSION,
    ...SAFE_DOWNLOAD_MIME_BY_EXTENSION,
  });
  if (expectedMime !== input.mimeType) throwArtifact("invalid_type");
  if (isTextMime(input.mimeType)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(input.content);
    } catch {
      throwArtifact("invalid_type");
    }
  }
  assertBinarySignature(input.mimeType, input.content);
}

/** Decodes text incrementally so callers do not need to concatenate upload streams. */
export async function assertUtf8Stream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      decoder.decode(value, { stream: true });
    }
    decoder.decode();
  } catch {
    throwArtifact("invalid_type");
  } finally {
    reader.releaseLock();
  }
}

export function normalizeArtifactLink(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return throwArtifact("invalid_input");
  }
  if (url.protocol !== "https:" || url.username || url.password) return throwArtifact("invalid_input");
  return url.toString();
}

export function normalizeArtifactOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return throwArtifact("invalid_origin");
  }
  if (url.protocol !== "https:" || !url.hostname || url.hostname.includes("*") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return throwArtifact("invalid_origin");
  }
  return url.origin;
}

export function normalizeArtifactOrigins(inputs: readonly string[]): string[] {
  if (!Array.isArray(inputs)) return throwArtifact("invalid_origin");
  const origins = [...new Set(inputs.map(normalizeArtifactOrigin))].sort();
  if (origins.length > ARTIFACT_LIMITS.origins) return throwArtifact("limit_exceeded");
  return origins;
}

export function isStaticDependencyOrigin(origin: string): boolean {
  try {
    return (STATIC_DEPENDENCY_ORIGINS as readonly string[]).includes(normalizeArtifactOrigin(origin));
  } catch {
    return false;
  }
}

export function canonicalManifest(files: readonly ArtifactManifestFile[]): string {
  const normalized = files
    .map((file) => {
      const path = normalizeArtifactPath(file.path);
      if (!Number.isSafeInteger(file.byteSize) || file.byteSize < 0) throwArtifact("invalid_manifest");
      if (!SHA256.test(file.sha256)) throwArtifact("invalid_checksum");
      return { ...file, path, sha256: file.sha256.toLowerCase() };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (normalized.some((file, index) => index > 0 && file.path === normalized[index - 1].path)) {
    return throwArtifact("invalid_manifest");
  }
  return normalized
    .map((file) => `${file.path}\n${file.mimeType}\n${file.byteSize}\n${file.sha256}\n`)
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function manifestHash(files: readonly ArtifactManifestFile[]): Promise<string> {
  return sha256Hex(canonicalManifest(files));
}

function canonicalMutationValue(value: unknown, key?: string): unknown {
  if (key && /(?:^|_)(?:content|body|raw_content)$/iu.test(key)) throwArtifact("invalid_input");
  if (Array.isArray(value)) {
    if (key === "origins" || key === "allowedDataOrigins") {
      if (!value.every((item): item is string => typeof item === "string")) throwArtifact("invalid_input");
      return normalizeArtifactOrigins(value);
    }
    return value.map((item) => canonicalMutationValue(item));
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") throwArtifact("invalid_input");
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([childKey, childValue]) => [childKey, canonicalMutationValue(childValue, childKey)]),
  );
}

export async function mutationFingerprint(input: Record<string, unknown>): Promise<string> {
  if (!input || Array.isArray(input)) throwArtifact("invalid_input");
  return sha256Hex(JSON.stringify(canonicalMutationValue(input)));
}
