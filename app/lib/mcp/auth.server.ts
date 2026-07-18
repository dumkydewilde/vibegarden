import { getMcpAuthContext } from "agents/mcp";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  MCP_SCOPES,
  BODY_MAX_CHARS,
  RESPONSE_MAX_CHARS,
  type McpPrincipal,
  type McpScope,
} from "~/lib/mcp/contracts";
import { McpPublicError, toMcpErrorResult } from "~/lib/mcp/errors.server";

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Returns a stable, privacy-safe identifier for MCP audit and limiter keys. */
export async function hashMcpUser(env: Env, value: string): Promise<string> {
  if (!env.SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET is not set. Locally: put SESSION_SECRET=<any string> in .dev.vars and restart the dev server. Production: wrangler secret put SESSION_SECRET.",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toHex(signature).slice(0, 24);
}

function isMcpScope(scope: unknown): scope is McpScope {
  return typeof scope === "string"
    && (MCP_SCOPES as readonly string[]).includes(scope);
}

/** Reads identity exclusively from OAuth-provider-issued MCP request props. */
export function getMcpPrincipal(): McpPrincipal {
  const context = getMcpAuthContext();
  const props = context?.props;
  if (!props || typeof props.userId !== "string" || !props.userId.trim()
    || !Array.isArray(props.scopes)) {
    throw new McpPublicError(
      "internal_error",
      "The request could not be completed.",
    );
  }

  return {
    userId: props.userId,
    scopes: props.scopes.filter(isMcpScope),
  };
}

export function requireScope(principal: McpPrincipal, scope: McpScope): void {
  if (!principal.scopes.includes(scope)) {
    throw new McpPublicError(
      "insufficient_scope",
      "The required scope is missing.",
    );
  }
}

export function oauthChallenge(
  env: Env,
  scopes: McpScope[],
  error?: "insufficient_scope",
) {
  const parts = [
    `resource_metadata="${new URL("/.well-known/oauth-protected-resource", env.APP_ORIGIN)}"`,
    `scope="${scopes.join(" ")}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}

type McpToolOptions = {
  env: Env;
  toolName: string;
  requestId: string;
  requiredScope: McpScope;
  /** Kept at call sites to make the intended tool category explicit. */
  limiter: "general" | "history";
};

type McpToolValue = CallToolResult | Record<string, unknown>;

function isCallToolResult(value: McpToolValue): value is CallToolResult {
  return "content" in value && Array.isArray(value.content);
}

function toToolResult(value: McpToolValue): CallToolResult {
  if (isCallToolResult(value)) return value;
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function isTemporaryFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { message, name } = error as { message?: unknown; name?: unknown };
  const text = `${name ?? ""} ${message ?? ""}`;
  return /\b(?:D1(?:[_\s-]?ERROR)?|network|fetch|connection|timeout|ECONN)\b/i.test(text);
}

function hasOversizedTextualBody(result: CallToolResult): boolean {
  return result.content.some((content) => (
    content.type === "text" && content.text.length > BODY_MAX_CHARS
  ) || (
    content.type === "resource"
    && "text" in content.resource
    && content.resource.text.length > BODY_MAX_CHARS
  ));
}

function cappedResult(value: McpToolValue): CallToolResult {
  const result = toToolResult(value);
  if (hasOversizedTextualBody(result)
    || JSON.stringify(result).length > RESPONSE_MAX_CHARS) {
    throw new McpPublicError(
      "internal_error",
      "The response could not be completed.",
    );
  }
  return result;
}

/**
 * Applies the MCP server's trust boundary, rate limits, output bound, and
 * privacy-safe operational logging around an individual read-only tool.
 */
export async function runMcpTool(
  options: McpToolOptions,
  handler: () => Promise<McpToolValue>,
): Promise<CallToolResult> {
  const startedAt = performance.now();
  let userHash = "unavailable";
  let outcome = "internal_error";

  try {
    const principal = getMcpPrincipal();
    userHash = await hashMcpUser(options.env, principal.userId);
    requireScope(principal, options.requiredScope);

    const limiter = options.toolName === "get_conversation"
      ? options.env.MCP_HISTORY_LIMITER
      : options.env.MCP_GENERAL_LIMITER;
    const limited = await limiter.limit({ key: `${userHash}:${options.toolName}` });
    if (!limited.success) {
      throw new McpPublicError(
        "rate_limited",
        "Rate limit reached. Please try again shortly.",
        true,
      );
    }

    const result = cappedResult(await handler());
    outcome = "success";
    return result;
  } catch (error) {
    const publicError = error instanceof McpPublicError
      ? error
      : isTemporaryFailure(error)
        ? new McpPublicError(
            "temporarily_unavailable",
            "The request could not be completed.",
            true,
          )
        : new McpPublicError("internal_error", "The request could not be completed.");
    outcome = publicError.code;
    if (!(error instanceof McpPublicError)) {
      console.error(JSON.stringify({
        event: "mcp_tool_error",
        errorClass: "unexpected_error",
        requestId: options.requestId,
      }));
    }
    const challenge = publicError.code === "insufficient_scope"
      ? oauthChallenge(options.env, [options.requiredScope], "insufficient_scope")
      : undefined;
    return toMcpErrorResult(publicError, challenge);
  } finally {
    console.info(JSON.stringify({
      event: "mcp_tool",
      tool: options.toolName,
      outcome,
      latencyMs: Math.round(performance.now() - startedAt),
      requestId: options.requestId,
      userHash,
    }));
  }
}
