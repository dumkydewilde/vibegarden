import { describe, expect, it } from "vitest";

import { ArtifactError } from "../contracts";
import {
  createLinkArtifact,
  createTextArtifact,
  createUploadSession,
} from "../service.server";

const userId = "user-a";
const unavailableEnv = {} as Env;

async function expectCode(action: () => Promise<unknown>, code: string) {
  await expect(action()).rejects.toMatchObject({ code } satisfies Partial<ArtifactError>);
}

describe("artifact service contract", () => {
  it("rejects caller-controlled identities, versions, storage keys, sources, and visibility before persistence", async () => {
    await expectCode(
      () => createUploadSession(unavailableEnv, userId, {
        project: { projectId: "project-a" },
        type: "html",
        title: "Landing page",
        idempotencyKey: "create-landing",
        artifactId: "caller-artifact",
        versionId: "caller-version",
        versionNumber: 8,
        r2Key: "artifacts/caller/versions/caller/index.html",
        source: "mcp",
        visibility: "gallery",
      } as never),
      "invalid_input",
    );
  });

  it("rejects MCP text creation without an existing project before it can write", async () => {
    await expectCode(
      () => createTextArtifact(unavailableEnv, { userId, clubId: "club-a" }, {
        type: "file",
        title: "Notes",
        idempotencyKey: "text-notes",
        files: [{ path: "notes.txt", content: "hello" }],
      } as never),
      "invalid_input",
    );
  });

  it("rejects unsafe links before looking up storage or projects", async () => {
    await expectCode(
      () => createLinkArtifact(unavailableEnv, userId, {
        project: { projectId: "project-a" },
        title: "Insecure link",
        url: "http://example.com",
        idempotencyKey: "insecure-link",
      } as never),
      "invalid_input",
    );
  });
});
