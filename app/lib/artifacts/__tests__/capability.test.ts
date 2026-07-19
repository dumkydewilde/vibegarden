import { describe, expect, it } from "vitest";

import {
  issueCapability,
  type RendererCapability,
  verifyCapability,
} from "../capability";

const secrets = {
  rendererSigningSecret: "renderer-signing-secret",
  sessionSecret: "session-secret",
};

const capability: RendererCapability = {
  tokenVersion: 1,
  policyVersion: 1,
  mode: "preview",
  versionId: "version_1",
  prefix: "artifacts/artifact_1/versions/version_1",
  entryPath: "index.html",
  allowedDataOrigins: ["https://api.example.com"],
  exp: 1_800_000_000,
};

describe("renderer capabilities", () => {
  it("round-trips canonical v1 claims", async () => {
    const token = await issueCapability(capability, secrets);

    await expect(verifyCapability(token, { rendererSigningSecret: secrets.rendererSigningSecret, now: 1_700_000_000 }))
      .resolves.toEqual(capability);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["payload", (token: string) => `A${token.slice(1)}`],
    ["signature", (token: string) => `${token.slice(0, -1)}A`],
  ])("rejects %s tampering", async (_kind, tamper) => {
    const token = await issueCapability(capability, secrets);

    await expect(verifyCapability(tamper(token), { rendererSigningSecret: secrets.rendererSigningSecret, now: 1_700_000_000 }))
      .resolves.toBeNull();
  });

  it.each([
    ["mode", "\"mode\":\"preview\"", "\"mode\":\"download\""],
    ["prefix", "artifacts/artifact_1/versions/version_1", "artifacts/artifact_2/versions/version_1"],
    ["entry path", "index.html", "other.html"],
  ])("rejects a tampered %s even when its payload remains well-formed", async (_kind, before, after) => {
    const token = await issueCapability(capability, secrets);
    const [payload, signature] = token.split(".");
    const decoded = atob(payload.replace(/-/gu, "+").replace(/_/gu, "/"));
    const changed = btoa(decoded.replace(before, after)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

    await expect(verifyCapability(`${changed}.${signature}`, { rendererSigningSecret: secrets.rendererSigningSecret, now: 1_700_000_000 }))
      .resolves.toBeNull();
  });

  it("rejects expired claims", async () => {
    const token = await issueCapability({ ...capability, exp: 1_700_000_000 }, secrets);

    await expect(verifyCapability(token, { rendererSigningSecret: secrets.rendererSigningSecret, now: 1_700_000_000 }))
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
    await expect(issueCapability({ ...capability, ...patch } as RendererCapability, secrets)).rejects.toThrow();
  });

  it("refuses empty or reused signing secrets", async () => {
    await expect(issueCapability(capability, { ...secrets, rendererSigningSecret: "" })).rejects.toThrow();
    await expect(issueCapability(capability, { rendererSigningSecret: "same", sessionSecret: "same" })).rejects.toThrow();
  });
});
