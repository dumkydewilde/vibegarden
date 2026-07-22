import { describe, expect, it } from "vitest";
import { ARTIFACT_LIMITS } from "~/lib/artifacts/contracts";
import {
  MCP_SCOPES,
  MCP_TOOL_ORDER,
  artifactMutationOutput,
  clampPageSize,
  createArtifactInput,
  createArtifactVersionInput,
  shareArtifactInput,
} from "~/lib/mcp/contracts";

describe("MCP contracts", () => {
  it("keeps scopes and discovery order stable", () => {
    expect(MCP_SCOPES).toEqual([
      "projects:read", "content:read", "artifacts:write", "artifacts:publish",
    ]);
    expect(MCP_TOOL_ORDER.slice(-3)).toEqual([
      "create_artifact", "create_artifact_version", "share_artifact",
    ]);
  });

  it("keeps artifact creation inputs strict and public", () => {
    const input = {
      project_id: "project-1",
      title: "Landing page",
      files: [{ path: "index.html", content: "<h1>Hello</h1>", mime_type: "text/html" }],
      idempotency_key: "create-landing-1",
    };

    expect(createArtifactInput.safeParse(input).success).toBe(true);
    expect(createArtifactInput.safeParse({ ...input, type: "html" }).success).toBe(false);
    expect(createArtifactInput.safeParse({ ...input, user_id: "user-1" }).success).toBe(false);
    expect(createArtifactInput.safeParse({ ...input, club_id: "club-1" }).success).toBe(false);
    expect(createArtifactInput.safeParse({ ...input, files: [{ ...input.files[0], extra: true }] }).success).toBe(false);
    expect(createArtifactInput.safeParse({ ...input, files: Array.from(
      { length: ARTIFACT_LIMITS.mcpFiles + 1 },
      (_, index) => ({ path: `${index}.html`, content: "" }),
    ) }).success).toBe(false);
  });

  it("keeps artifact version and sharing inputs exact", () => {
    const version = {
      artifact_id: "artifact-1",
      files: [{ path: "index.html", content: "<h1>Revision</h1>" }],
      idempotency_key: "revision-1",
    };

    expect(createArtifactVersionInput.safeParse(version).success).toBe(true);
    expect(createArtifactVersionInput.safeParse({ ...version, title: "Nope" }).success).toBe(false);
    expect(createArtifactVersionInput.safeParse({ ...version, description: "Nope" }).success).toBe(false);
    expect(createArtifactVersionInput.safeParse({ ...version, project_id: "project-1" }).success).toBe(false);
    expect(shareArtifactInput.safeParse({ artifact_id: "artifact-1", version_id: "version-1", confirm: true }).success).toBe(true);
    expect(shareArtifactInput.safeParse({ artifact_id: "artifact-1", version_id: "version-1", confirm: false }).success).toBe(false);
    expect(shareArtifactInput.safeParse({ artifact_id: "artifact-1", version_id: "version-1", confirm: "true" }).success).toBe(false);
  });

  it("keeps artifact mutation output safe and absolute", () => {
    const output = {
      artifact_id: "artifact-1",
      version_id: "version-1",
      visibility: "private",
      url: "https://vibegarden.test/clubs/wotf/artifacts/artifact-1",
    };

    expect(artifactMutationOutput.safeParse(output).success).toBe(true);
    expect(artifactMutationOutput.safeParse({ ...output, object_key: "secret" }).success).toBe(false);
  });

  it("uses separate list and conversation caps", () => {
    expect(clampPageSize(undefined, "list")).toBe(20);
    expect(clampPageSize(500, "list")).toBe(50);
    expect(clampPageSize(undefined, "conversation")).toBe(50);
    expect(clampPageSize(500, "conversation")).toBe(100);
  });
});
