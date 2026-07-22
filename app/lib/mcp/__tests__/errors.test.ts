import { describe, expect, it } from "vitest";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { toMcpArtifactError } from "~/lib/mcp/artifact-errors.server";
import { McpPublicError, toMcpErrorResult } from "~/lib/mcp/errors.server";

function errorBody(error: unknown) {
  const result = toMcpErrorResult(error);
  return JSON.parse(result.content[0].text);
}

describe("MCP public errors", () => {
  it("maps artifact failures to explicit safe MCP errors", () => {
    expect(toMcpArtifactError(new ArtifactError("not_found"))).toMatchObject({
      code: "not_found",
      message: "Artifact was not found.",
      retryable: false,
    });
    for (const code of [
      "invalid_input", "invalid_path", "invalid_type", "invalid_origin", "invalid_checksum",
      "invalid_manifest", "limit_exceeded", "idempotency_conflict",
    ] as const) {
      expect(toMcpArtifactError(new ArtifactError(code))).toMatchObject({
        code: "invalid_input",
        message: new ArtifactError(code).message,
        retryable: false,
      });
    }
    expect(toMcpArtifactError(new ArtifactError("storage_unavailable"))).toMatchObject({
      code: "temporarily_unavailable",
      message: "Artifact storage is temporarily unavailable.",
      retryable: true,
    });
    expect(toMcpArtifactError(new Error("database password: do-not-expose"))).toMatchObject({
      code: "internal_error",
      message: "The request could not be completed.",
      retryable: false,
    });
  });

  it("allows missing and foreign records to share not_found", () => {
    const missing = errorBody(new McpPublicError("not_found", "Not found."));
    const foreign = errorBody(new McpPublicError("not_found", "Not found."));

    expect(missing.error).toEqual(foreign.error);
    expect(missing.error.code).toBe("not_found");
  });

  it("maps D1-shaped errors to temporarily_unavailable", () => {
    const error = errorBody(new Error("D1_ERROR: database unavailable"));

    expect(error.error).toEqual({
      code: "temporarily_unavailable",
      message: "The request could not be completed.",
      retryable: true,
    });
  });

  it("treats arbitrary thrown objects and throwing accessors as internal errors", () => {
    const hostile = {};
    Object.defineProperty(hostile, "message", {
      get() { throw new Error("access denied"); },
    });

    for (const failure of [{ name: "D1_ERROR", message: "unavailable" }, hostile]) {
      expect(errorBody(failure).error).toEqual({
        code: "internal_error",
        message: "The request could not be completed.",
        retryable: false,
      });
    }
  });

  it("does not expose unexpected error messages or stacks", () => {
    const failure = new Error("database password: do-not-expose");
    failure.stack = "sensitive stack trace";

    const result = toMcpErrorResult(failure, "Bearer realm=\"gardener\"");

    expect(result).toMatchObject({
      isError: true,
      _meta: { "mcp/www_authenticate": ["Bearer realm=\"gardener\""] },
    });
    expect(result.content[0].text).toBe(JSON.stringify({
      error: {
        code: "internal_error",
        message: "The request could not be completed.",
        retryable: false,
      },
    }));
    expect(result.content[0].text).not.toContain("password");
    expect(result.content[0].text).not.toContain("stack");
  });
});
