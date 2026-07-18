import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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

function isTemporaryFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { message, name } = error as { message?: unknown; name?: unknown };
  return /\b(?:D1(?:[_\s-]?ERROR)?|network|fetch|connection|timeout|ECONN)\b/i
    .test(`${name ?? ""} ${message ?? ""}`);
}

export function toMcpPublicError(error: unknown): McpPublicError {
  return error instanceof McpPublicError
    ? error
    : isTemporaryFailure(error)
      ? new McpPublicError(
          "temporarily_unavailable",
          "The request could not be completed.",
          true,
        )
      : new McpPublicError("internal_error", "The request could not be completed.");
}

export function mcpPublicErrorData(error: McpPublicError, challenge?: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
    ...(challenge ? { _meta: { "mcp/www_authenticate": [challenge] } } : {}),
  };
}

export function toMcpErrorResult(error: unknown, challenge?: string): CallToolResult {
  const publicError = toMcpPublicError(error);
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify(mcpPublicErrorData(publicError)),
    }],
    ...(challenge ? { _meta: { "mcp/www_authenticate": [challenge] } } : {}),
  };
}

/** Converts a public MCP failure to a protocol error for resources and prompts. */
export function toMcpProtocolError(error: unknown, challenge?: string): McpError {
  const publicError = toMcpPublicError(error);
  const code = publicError.code === "internal_error"
    || publicError.code === "temporarily_unavailable"
    ? ErrorCode.InternalError
    : ErrorCode.InvalidParams;
  return new McpError(code, publicError.message, mcpPublicErrorData(publicError, challenge));
}
