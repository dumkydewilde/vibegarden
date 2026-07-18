import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type McpErrorCode =
  | "invalid_input"
  | "invalid_cursor"
  | "not_found"
  | "insufficient_scope"
  | "rate_limited"
  | "temporarily_unavailable"
  | "internal_error";

export class McpPublicError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

function isD1Error(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { message, name } = error as { message?: unknown; name?: unknown };
  return typeof message === "string"
    && /\bD1(?:[_\s-]?ERROR)?\b/i.test(`${name ?? ""} ${message}`);
}

export function toMcpErrorResult(error: unknown, challenge?: string): CallToolResult {
  const publicError = error instanceof McpPublicError
    ? error
    : isD1Error(error)
      ? new McpPublicError(
          "temporarily_unavailable",
          "The request could not be completed.",
          true,
        )
      : new McpPublicError("internal_error", "The request could not be completed.");
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({
        error: {
          code: publicError.code,
          message: publicError.message,
          retryable: publicError.retryable,
        },
      }),
    }],
    ...(challenge ? { _meta: { "mcp/www_authenticate": [challenge] } } : {}),
  };
}
