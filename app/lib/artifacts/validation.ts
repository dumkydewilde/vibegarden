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
const WINDOWS_DRIVE_QUALIFIED_PATH = /^[a-z]:/iu;
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
const KNOWN_ARTIFACT_MIME_TYPES = new Set([
  ...Object.values(HTML_PACKAGE_MIME_BY_EXTENSION),
  ...Object.values(SAFE_DOWNLOAD_MIME_BY_EXTENSION),
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

function hasUnpairedUtf16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function normalizeArtifactPath(input: string): string {
  if (
    typeof input !== "string" ||
    !input ||
    input.includes("\\") ||
    WINDOWS_DRIVE_QUALIFIED_PATH.test(input) ||
    hasUnpairedUtf16Surrogate(input) ||
    CONTROL_CHARACTERS.test(input)
  ) {
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
    if (!Number.isSafeInteger(file.zipUnixMode)) return throwArtifact("invalid_manifest");
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
    if (!isRecord(file)) return throwArtifact("invalid_manifest");
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
  if (!Array.isArray(files)) return throwArtifact("invalid_manifest");
  const normalized = files
    .map((file) => {
      if (!isRecord(file)) return throwArtifact("invalid_manifest");
      const path = normalizeArtifactPath(file.path);
      if (!Number.isSafeInteger(file.byteSize) || file.byteSize < 0) throwArtifact("invalid_manifest");
      if (
        typeof file.mimeType !== "string" ||
        mimeFor(path, { ...HTML_PACKAGE_MIME_BY_EXTENSION, ...SAFE_DOWNLOAD_MIME_BY_EXTENSION }) !== file.mimeType
      ) {
        throwArtifact("invalid_manifest");
      }
      if (typeof file.sha256 !== "string") throwArtifact("invalid_checksum");
      if (!SHA256.test(file.sha256)) throwArtifact("invalid_checksum");
      return { ...file, path, sha256: file.sha256.toLowerCase() };
    })
    .sort((left, right) => compareCanonicalStrings(left.path, right.path));
  if (normalized.some((file, index) => index > 0 && file.path === normalized[index - 1].path)) {
    return throwArtifact("invalid_manifest");
  }
  return normalized
    .map((file) => `${file.path}\n${file.mimeType}\n${file.byteSize}\n${file.sha256}\n`)
    .join("");
}

function compareCanonicalStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function manifestHash(files: readonly ArtifactManifestFile[]): Promise<string> {
  return sha256Hex(canonicalManifest(files));
}

const MUTATION_FIELDS = new Set(["title", "description", "allowedDataOrigins", "files"]);
const MUTATION_FILE_FIELDS = new Set(["path", "mimeType", "byteSize", "sha256"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertKnownFields(value: Record<string, unknown>, fields: ReadonlySet<string>): void {
  if (Object.keys(value).some((key) => !fields.has(key))) throwArtifact("invalid_input");
}

function canonicalMutationFile(value: unknown): Record<string, string | number> {
  if (!isRecord(value)) return throwArtifact("invalid_input");
  assertKnownFields(value, MUTATION_FILE_FIELDS);
  if ([...MUTATION_FILE_FIELDS].some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    return throwArtifact("invalid_input");
  }

  const path = typeof value.path === "string" ? normalizeArtifactPath(value.path) : throwArtifact("invalid_input");
  const mimeType = value.mimeType;
  if (
    typeof mimeType !== "string" ||
    !KNOWN_ARTIFACT_MIME_TYPES.has(mimeType) ||
    mimeFor(path, { ...HTML_PACKAGE_MIME_BY_EXTENSION, ...SAFE_DOWNLOAD_MIME_BY_EXTENSION }) !== mimeType
  ) {
    return throwArtifact("invalid_input");
  }
  const sha256 = value.sha256;
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) return throwArtifact("invalid_input");
  const byteSize = value.byteSize;
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) return throwArtifact("invalid_input");

  const canonical: Record<string, string | number> = {};
  for (const [key, field] of [
    ["byteSize", byteSize],
    ["mimeType", mimeType],
    ["path", path],
    ["sha256", sha256.toLowerCase()],
  ].sort(([left], [right]) => compareCanonicalStrings(left, right))) {
    canonical[key] = field;
  }
  return canonical;
}

function canonicalMutationValue(input: Record<string, unknown>): Record<string, unknown> {
  assertKnownFields(input, MUTATION_FIELDS);
  const canonical: Record<string, unknown> = {};
  for (const key of [...MUTATION_FIELDS].sort()) {
    const value = input[key];
    if (value === undefined) continue;
    if (key === "allowedDataOrigins") {
      if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
        return throwArtifact("invalid_input");
      }
      canonical[key] = normalizeArtifactOrigins(value);
    } else if (key === "files") {
      if (!Array.isArray(value)) return throwArtifact("invalid_input");
      const files = value.map(canonicalMutationFile);
      const paths = new Set<string>();
      for (const file of files) {
        const path = file.path;
        if (typeof path !== "string" || paths.has(path)) return throwArtifact("invalid_input");
        paths.add(path);
      }
      canonical[key] = files;
    } else if (
      typeof value === "string" &&
      Array.from(value).length <= (key === "title" ? ARTIFACT_LIMITS.titleChars : ARTIFACT_LIMITS.descriptionChars)
    ) {
      canonical[key] = value;
    } else {
      return throwArtifact("invalid_input");
    }
  }
  return canonical;
}

export async function mutationFingerprint(input: Record<string, unknown>): Promise<string> {
  if (!isRecord(input)) throwArtifact("invalid_input");
  return sha256Hex(JSON.stringify(canonicalMutationValue(input)));
}
