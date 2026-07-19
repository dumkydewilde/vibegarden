import { describe, expect, it } from "vitest";

import {
  issueCapability,
  type RendererCapability,
  verifyCapability,
} from "../capability";
import { ARTIFACT_LIMITS } from "../contracts";

const secrets = {
  rendererSigningSecret: "renderer-signing-secret",
  sessionSecret: "session-secret",
};

const issuedAt = 1_700_000_000;

const capability: RendererCapability = {
  tokenVersion: 1,
  policyVersion: 1,
  mode: "preview",
  versionId: "version_1",
  prefix: "artifacts/artifact_1/versions/version_1",
  entryPath: "index.html",
  allowedDataOrigins: ["https://api.example.com"],
  exp: issuedAt + ARTIFACT_LIMITS.capabilityTtlSeconds,
};

function base64urlEncode(value: string): string {
  return btoa(value).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

async function signCapability(value: Record<string, unknown>): Promise<string> {
  const payload = base64urlEncode(JSON.stringify(value));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secrets.rendererSigningSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const binary = String.fromCharCode(...new Uint8Array(signature));
  return `${payload}.${base64urlEncode(binary)}`;
}

function replaceFinalCharacter(value: string): string {
  const finalCharacter = value.at(-1);
  if (!finalCharacter) throw new Error("A capability token segment must not be empty.");
  return `${value.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`;
}

describe("renderer capabilities", () => {
  it("round-trips canonical v1 claims", async () => {
    const token = await issueCapability(capability, secrets, { now: issuedAt });

    await expect(verifyCapability(token, { rendererSigningSecret: secrets.rendererSigningSecret, now: issuedAt }))
      .resolves.toEqual(capability);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["payload", (token: string) => `A${token.slice(1)}`],
    ["signature", (token: string) => {
      const [payload, signature] = token.split(".");
      return `${payload}.${replaceFinalCharacter(signature)}`;
    }],
  ])("rejects %s tampering", async (_kind, tamper) => {
    const token = await issueCapability(capability, secrets, { now: issuedAt });

    await expect(verifyCapability(tamper(token), { rendererSigningSecret: secrets.rendererSigningSecret, now: issuedAt }))
      .resolves.toBeNull();
  });

  it.each([
    ["mode", "\"mode\":\"preview\"", "\"mode\":\"download\""],
    ["prefix", "artifacts/artifact_1/versions/version_1", "artifacts/artifact_2/versions/version_1"],
    ["entry path", "index.html", "other.html"],
  ])("rejects a tampered %s even when its payload remains well-formed", async (_kind, before, after) => {
    const token = await issueCapability(capability, secrets, { now: issuedAt });
    const [payload, signature] = token.split(".");
    const decoded = atob(payload.replace(/-/gu, "+").replace(/_/gu, "/"));
    const changed = btoa(decoded.replace(before, after)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

    await expect(verifyCapability(`${changed}.${signature}`, { rendererSigningSecret: secrets.rendererSigningSecret, now: issuedAt }))
      .resolves.toBeNull();
  });

  it("rejects expired claims", async () => {
    const token = await issueCapability({ ...capability, exp: issuedAt + ARTIFACT_LIMITS.capabilityTtlSeconds }, secrets, { now: issuedAt });

    await expect(verifyCapability(token, { rendererSigningSecret: secrets.rendererSigningSecret, now: capability.exp }))
      .resolves.toBeNull();
  });

  it.each([
    ["one second short", issuedAt + ARTIFACT_LIMITS.capabilityTtlSeconds - 1],
    ["one second long", issuedAt + ARTIFACT_LIMITS.capabilityTtlSeconds + 1],
    ["years long", issuedAt + 365 * 24 * 60 * 60],
  ])("only issues a capability for the exact five-minute lifetime: %s", async (_boundary, exp) => {
    await expect(issueCapability({ ...capability, exp }, secrets, { now: issuedAt })).rejects.toThrow();
  });

  it("rejects a correctly signed capability whose lifetime exceeds five minutes", async () => {
    const token = await signCapability({ ...capability, exp: issuedAt + 365 * 24 * 60 * 60 });

    await expect(verifyCapability(token, { rendererSigningSecret: secrets.rendererSigningSecret, now: issuedAt }))
      .resolves.toBeNull();
  });

  it.each([
    ["token", { tokenVersion: 2 }],
    ["policy", { policyVersion: 2 }],
  ])("rejects a correctly signed future %s version", async (_kind, patch) => {
    const token = await signCapability({ ...capability, ...patch });

    await expect(verifyCapability(token, { rendererSigningSecret: secrets.rendererSigningSecret, now: issuedAt }))
      .resolves.toBeNull();
  });

  it.each([
    ["future token version", { tokenVersion: 2 }],
    ["future policy version", { policyVersion: 2 }],
    ["mode", { mode: "admin" }],
    ["prefix", { prefix: "artifacts/artifact_1/versions/another_version" }],
    ["entry path", { entryPath: "../secret.html" }],
    ["data origins", { allowedDataOrigins: ["https://B.example", "https://a.example:443"] }],
  ])("refuses non-canonical %s claims during issuance", async (_kind, patch) => {
    await expect(issueCapability({ ...capability, ...patch } as RendererCapability, secrets, { now: issuedAt })).rejects.toThrow();
  });

  it("refuses empty or reused signing secrets", async () => {
    await expect(issueCapability(capability, { ...secrets, rendererSigningSecret: "" }, { now: issuedAt })).rejects.toThrow();
    await expect(issueCapability(capability, { rendererSigningSecret: "same", sessionSecret: "same" }, { now: issuedAt })).rejects.toThrow();
  });
});
