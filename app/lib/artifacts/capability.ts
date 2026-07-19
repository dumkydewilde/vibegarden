import { normalizeArtifactOrigins, normalizeArtifactPath } from "./validation";

const encoder = new TextEncoder();
const TOKEN_VERSION = 1;
const POLICY_VERSION = 1;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const CAPABILITY_KEYS = [
  "tokenVersion",
  "policyVersion",
  "mode",
  "versionId",
  "prefix",
  "entryPath",
  "allowedDataOrigins",
  "exp",
] as const;

export type RendererCapability = {
  tokenVersion: 1;
  policyVersion: 1;
  mode: "preview" | "download";
  versionId: string;
  prefix: string;
  entryPath: string;
  allowedDataOrigins: string[];
  exp: number;
};

export type CapabilitySecrets = {
  rendererSigningSecret: string;
  sessionSecret: string;
};

export type VerifyCapabilityOptions = {
  rendererSigningSecret: string;
  /** Unix seconds. Defaults to the current clock for production verification. */
  now?: number;
};

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64urlDecode(value: string): Uint8Array | null {
  if (!BASE64URL.test(value)) return null;
  try {
    const padded = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return base64urlEncode(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function canonicalJson(capability: RendererCapability): string {
  return JSON.stringify({
    tokenVersion: capability.tokenVersion,
    policyVersion: capability.policyVersion,
    mode: capability.mode,
    versionId: capability.versionId,
    prefix: capability.prefix,
    entryPath: capability.entryPath,
    allowedDataOrigins: capability.allowedDataOrigins,
    exp: capability.exp,
  });
}

function invalidCapability(): never {
  throw new Error("Renderer capability is invalid.");
}

function canonicalCapability(value: unknown): RendererCapability {
  if (!isRecord(value) || !hasExactCapabilityKeys(value)) return invalidCapability();
  if (value.tokenVersion !== TOKEN_VERSION || value.policyVersion !== POLICY_VERSION) return invalidCapability();
  if (value.mode !== "preview" && value.mode !== "download") return invalidCapability();
  if (typeof value.versionId !== "string" || !IDENTIFIER.test(value.versionId)) return invalidCapability();
  if (typeof value.prefix !== "string" || !immutablePrefix(value.versionId, value.prefix)) return invalidCapability();
  if (typeof value.entryPath !== "string" || normalizeArtifactPath(value.entryPath) !== value.entryPath) return invalidCapability();
  if (!Array.isArray(value.allowedDataOrigins) || value.allowedDataOrigins.some((origin) => typeof origin !== "string")) {
    return invalidCapability();
  }
  const allowedDataOrigins = normalizeArtifactOrigins(value.allowedDataOrigins);
  if (!sameStrings(allowedDataOrigins, value.allowedDataOrigins)) return invalidCapability();
  if (!Number.isSafeInteger(value.exp) || value.exp <= 0) return invalidCapability();

  return {
    tokenVersion: TOKEN_VERSION,
    policyVersion: POLICY_VERSION,
    mode: value.mode,
    versionId: value.versionId,
    prefix: value.prefix,
    entryPath: value.entryPath,
    allowedDataOrigins,
    exp: value.exp,
  };
}

function immutablePrefix(versionId: string, prefix: string): boolean {
  const match = /^artifacts\/([A-Za-z0-9][A-Za-z0-9_-]*)\/versions\/([A-Za-z0-9][A-Za-z0-9_-]*)$/u.exec(prefix);
  return match !== null && match[2] === versionId;
}

function sameStrings(left: readonly string[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactCapabilityKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === CAPABILITY_KEYS.length && CAPABILITY_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function assertSigningSecrets(secrets: CapabilitySecrets): void {
  if (
    !secrets ||
    typeof secrets.rendererSigningSecret !== "string" ||
    typeof secrets.sessionSecret !== "string" ||
    !secrets.rendererSigningSecret ||
    !secrets.sessionSecret ||
    secrets.rendererSigningSecret === secrets.sessionSecret
  ) {
    throw new Error("Renderer signing secret must be distinct from the session secret.");
  }
}

/** Issues the only supported canonical, signed renderer capability format. */
export async function issueCapability(input: RendererCapability, secrets: CapabilitySecrets): Promise<string> {
  assertSigningSecrets(secrets);
  const capability = canonicalCapability(input);
  const payload = base64urlEncode(encoder.encode(canonicalJson(capability)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secrets.rendererSigningSecret), encoder.encode(payload));
  return `${payload}.${base64urlEncode(new Uint8Array(signature))}`;
}

/** Returns verified v1 claims or null without exposing why a bearer token failed. */
export async function verifyCapability(token: string, options: VerifyCapabilityOptions): Promise<RendererCapability | null> {
  if (!options || typeof options.rendererSigningSecret !== "string" || !options.rendererSigningSecret || typeof token !== "string") {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const payload = base64urlDecode(parts[0]);
  const signature = base64urlDecode(parts[1]);
  if (!payload || !signature) return null;

  try {
    const verified = await crypto.subtle.verify("HMAC", await hmacKey(options.rendererSigningSecret), signature, encoder.encode(parts[0]));
    if (!verified) return null;
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    const capability = canonicalCapability(JSON.parse(decoded));
    if (canonicalJson(capability) !== decoded) return null;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    return Number.isSafeInteger(now) && capability.exp > now ? capability : null;
  } catch {
    return null;
  }
}
