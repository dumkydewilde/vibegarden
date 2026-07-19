import { describe, expect, it } from "vitest";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactJsonAction } from "~/lib/artifacts/http.server";
import { assertWebsiteWriteOrigin } from "~/lib/request-security.server";

const env = {
  WEB_ALLOWED_ORIGINS: "https://vibegarden.club, http://localhost:5173",
} as Env;

const actionPaths = [
  "/login",
  "/logout",
  "/welcome",
  "/garden",
  "/garden/conversations/thread-1",
  "/garden/projects/project-1",
  "/inspiration",
  "/learning/example",
  "/api/chat",
  "/api/thread",
  "/api/feedback",
  "/admin",
];

function actionRequest(path: string, origin?: string | null) {
  const headers = new Headers();
  if (origin !== undefined) headers.set("Origin", origin ?? "null");
  return new Request(`https://vibegarden.club${path}`, { method: "POST", headers });
}

describe("website action origin boundary", () => {
  it.each(actionPaths)("allows the configured website origin for %s", (path) => {
    expect(() => assertWebsiteWriteOrigin(actionRequest(path, "https://vibegarden.club"), env)).not.toThrow();
  });

  it.each(actionPaths.flatMap((path) => [
    [path, undefined],
    [path, null],
    [path, "https://usercontent.vibegarden.club"],
    [path, "https://evil.example"],
  ]))("rejects %s before route services for origin %s", (path, origin) => {
    expect(() => assertWebsiteWriteOrigin(actionRequest(path, origin), env)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
});

describe("artifactJsonAction", () => {
  it("returns only the safe public fields for ArtifactError", async () => {
    const response = await artifactJsonAction(async () => {
      throw new ArtifactError("invalid_manifest");
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Artifact manifest is invalid.",
      status: 400,
      retryable: false,
    });
  });

  it("redacts unknown errors as internal_error", async () => {
    const response = await artifactJsonAction(async () => {
      throw new Error("D1 failed for artifacts/secret/source.html and alice@example.com");
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error" });
  });
});
