import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { verifyCapability } from "../../app/lib/artifacts/capability";
import { buildRendererHeaders } from "../../app/lib/artifacts/policy";

const rendererOrigin = "https://usercontent.vibegarden.club";
const parentOrigin = "https://vibegarden.club";

test("uploaded content cannot widen renderer CSP, CORS, or capability policy", async () => {
  const uploadedAttempt = await readFile(new URL("./fixtures/forbidden.html", import.meta.url), "utf8");
  const headers = buildRendererHeaders({ rendererOrigin, parentOrigin, assetKind: "entry" });
  const csp = headers.get("Content-Security-Policy") ?? "";

  expect(uploadedAttempt).toContain("https://evil.example");
  expect(uploadedAttempt).toContain("Access-Control-Allow-Origin");
  expect(uploadedAttempt).toContain("data-capability-mode=\"download\"");
  const uploadedCapability = /name="artifact-capability" content="([^"]+)"/u.exec(uploadedAttempt)?.[1];

  expect(csp).not.toContain("https://evil.example");
  expect(csp).not.toMatch(/connect-src[^;]*\*/u);
  expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect(headers.get("Cache-Control")).toBe("private, no-store");
  await expect(verifyCapability(uploadedCapability ?? "", { rendererSigningSecret: "renderer-signing-secret" })).resolves.toBeNull();
});
