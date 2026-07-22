import { ArtifactError } from "~/lib/artifacts/contracts";
import { McpPublicError } from "~/lib/mcp/errors.server";

const invalidInputCodes = new Set([
  "invalid_input",
  "invalid_path",
  "invalid_type",
  "limit_exceeded",
  "invalid_checksum",
  "invalid_manifest",
  "idempotency_conflict",
  "invalid_origin",
]);

/** Converts domain failures into the artifact tool's explicit public contract. */
export function toMcpArtifactError(error: unknown): McpPublicError {
  if (!(error instanceof ArtifactError)) {
    return new McpPublicError("internal_error", "The request could not be completed.");
  }
  if (error.code === "not_found") {
    return new McpPublicError("not_found", error.message);
  }
  if (invalidInputCodes.has(error.code)) {
    return new McpPublicError("invalid_input", error.message);
  }
  if (error.code === "storage_unavailable") {
    return new McpPublicError("temporarily_unavailable", error.message, true);
  }
  return new McpPublicError("internal_error", "The request could not be completed.");
}
