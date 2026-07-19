import { ArtifactError } from "./contracts";
import { normalizeArtifactPath } from "./validation";

const SHA256 = /^[a-f0-9]{64}$/u;
const KEY_PREFIX = /^artifacts\/([A-Za-z0-9][A-Za-z0-9_-]*)\/versions\/([A-Za-z0-9][A-Za-z0-9_-]*)$/u;

function assertIdentifier(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)) {
    throw new ArtifactError("invalid_input");
  }
}

function assertChecksum(value: string): void {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new ArtifactError("invalid_checksum");
  }
}

function prefixForKey(key: string): string {
  const segments = key.split("/");
  if (segments.length < 5 || segments[0] !== "artifacts" || segments[2] !== "versions") {
    throw new ArtifactError("invalid_path");
  }
  assertIdentifier(segments[1]);
  assertIdentifier(segments[3]);
  const path = normalizeArtifactPath(segments.slice(4).join("/"));
  return `artifacts/${segments[1]}/versions/${segments[3]}/${path}`;
}

function keyForPrefix(prefix: string, path: string): string {
  const match = KEY_PREFIX.exec(prefix);
  if (!match) throw new ArtifactError("invalid_path");
  return artifactObjectKey(match[1], match[2], path);
}

function r2WriteError(error: unknown): ArtifactError {
  return error instanceof Error && /checksum|sha-?256/iu.test(error.message)
    ? new ArtifactError("invalid_checksum")
    : new ArtifactError("storage_unavailable");
}

function hex(value: ArrayBuffer | undefined): string | undefined {
  if (!value) return undefined;
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checksumForBody(body: ArrayBuffer | string): Promise<string> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return hex(await crypto.subtle.digest("SHA-256", bytes))!;
}

export function artifactObjectKey(artifactId: string, versionId: string, path: string): string {
  assertIdentifier(artifactId);
  assertIdentifier(versionId);
  return `artifacts/${artifactId}/versions/${versionId}/${normalizeArtifactPath(path)}`;
}

export async function putLeasedObject(
  env: Env,
  input: {
    r2Key: string;
    body: ReadableStream | ArrayBuffer | string;
    mimeType: string;
    sha256: string;
  },
): Promise<{ byteSize: number; sha256: string }> {
  const key = prefixForKey(input.r2Key);
  assertChecksum(input.sha256);
  if (typeof input.mimeType !== "string" || !input.mimeType) {
    throw new ArtifactError("invalid_type");
  }

  if (typeof input.body === "string" || input.body instanceof ArrayBuffer) {
    if (await checksumForBody(input.body) !== input.sha256) {
      throw new ArtifactError("invalid_checksum");
    }
  }

  let written: R2Object;
  try {
    written = await env.ARTIFACTS.put(key, input.body, {
      sha256: input.sha256,
      httpMetadata: { contentType: input.mimeType },
      onlyIf: { etagDoesNotMatch: "*" },
    });
  } catch (error) {
    // R2 verifies streamed bodies using the supplied checksum.
    throw r2WriteError(error);
  }

  if (!written) throw new ArtifactError("state_conflict");

  const writtenChecksum = hex(written.checksums.sha256);
  let stored: R2Object | null;
  try {
    stored = await env.ARTIFACTS.head(key);
  } catch (error) {
    throw r2WriteError(error);
  }
  const storedChecksum = hex(stored?.checksums.sha256);
  if (!stored || writtenChecksum !== input.sha256 || storedChecksum !== input.sha256) {
    throw new ArtifactError("invalid_checksum");
  }
  return { byteSize: stored.size, sha256: input.sha256 };
}

export async function getVersionObject(
  env: Env,
  prefix: string,
  path: string,
): Promise<R2ObjectBody | null> {
  return env.ARTIFACTS.get(keyForPrefix(prefix, path));
}

export async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  const safeKeys = keys.map(prefixForKey);
  if (safeKeys.length > 0) await env.ARTIFACTS.delete(safeKeys);
}
