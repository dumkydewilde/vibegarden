import { describe, expect, it } from "vitest";
import { McpPublicError, toMcpErrorResult } from "~/lib/mcp/errors.server";

function errorBody(error: unknown) {
  const result = toMcpErrorResult(error);
  return JSON.parse(result.content[0].text);
}

describe("MCP public errors", () => {
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
