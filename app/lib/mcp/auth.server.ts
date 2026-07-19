import { getMcpAuthContext } from "agents/mcp";
import { getMcpRequestProps } from "~/lib/mcp/request-context.server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  MCP_SCOPES,
  BODY_MAX_CHARS,
  RESPONSE_MAX_CHARS,
  type McpPrincipal,
  type ResolvedMcpPrincipal,
  type McpScope,
} from "~/lib/mcp/contracts";
import {
  McpPublicError,
  toMcpErrorResult,
  toMcpProtocolError,
  toMcpPublicError,
} from "~/lib/mcp/errors.server";

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
  const props = getMcpRequestProps() ?? getMcpAuthContext()?.props;
  if (!props || typeof props.userId !== "string" || !props.userId.trim()
    || typeof props.clubId !== "string" || !props.clubId.trim()
    || !Array.isArray(props.scopes)) {
    throw new McpPublicError(
      "internal_error",
      "The request could not be completed.",
    );
  }

  return {
    userId: props.userId,
    clubId: props.clubId,
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

async function resolveMcpPrincipal(
  env: Env,
  principal: McpPrincipal,
): Promise<ResolvedMcpPrincipal> {
  const club = await env.DB
    .prepare(
      `SELECT clubs.slug AS clubSlug, clubs.name AS clubName
         FROM clubs
         JOIN users ON users.id = ?
         LEFT JOIN club_memberships
           ON club_memberships.club_id = clubs.id
          AND club_memberships.user_id = users.id
        WHERE clubs.id = ?
          AND clubs.status = 'active'
          AND (
            club_memberships.user_id IS NOT NULL
            OR users.platform_role = 'super_admin'
          )`,
    )
    .bind(principal.userId, principal.clubId)
    .first<{ clubSlug: string; clubName: string }>();
  if (!club) {
    throw new McpPublicError(
      "not_found",
      "The connected club is unavailable.",
    );
  }
  return { ...principal, ...club };
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
  requiredScope: McpScope | McpScope[];
  /** Kept at call sites to make the intended tool category explicit. */
  limiter: "general" | "history";
};

type McpRequestOptions = McpToolOptions & {
  kind: "tool" | "resource" | "prompt";
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

function hasOversizedTextualBody(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  if (typeof value.text === "string" && value.text.length > BODY_MAX_CHARS) {
    return true;
  }
  return Object.values(value).some((child) => (
    Array.isArray(child)
      ? child.some((item) => hasOversizedTextualBody(item))
      : hasOversizedTextualBody(child)
  ));
}

function assertResponseCaps(result: object): void {
  if (hasOversizedTextualBody(result)
    || JSON.stringify(result).length > RESPONSE_MAX_CHARS) {
    throw new McpPublicError(
      "internal_error",
      "The response could not be completed.",
    );
  }
}

/**
 * Applies the common MCP trust boundary to each protocol response shape.
 * Resource and prompt handlers deliberately receive typed protocol responses,
 * never a tool-shaped CallToolResult.
 */
export async function runMcpRequest<T extends object>(
  options: McpRequestOptions,
  handler: (principal: ResolvedMcpPrincipal) => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  let userHash = "unavailable";
  let outcome = "internal_error";

  try {
    const principal = await resolveMcpPrincipal(options.env, getMcpPrincipal());
    userHash = await hashMcpUser(options.env, principal.userId);
    const requiredScopes = Array.isArray(options.requiredScope)
      ? options.requiredScope
      : [options.requiredScope];
    if (!requiredScopes.some((scope) => principal.scopes.includes(scope))) {
      throw new McpPublicError(
        "insufficient_scope",
        "The required scope is missing.",
      );
    }

    const useHistoryLimiter = options.kind === "tool"
      ? options.toolName === "get_conversation"
      : options.limiter === "history";
    const limiter = useHistoryLimiter
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

    const result = await handler(principal);
    assertResponseCaps(result);
    outcome = "success";
    return result;
  } catch (error) {
    const publicError = toMcpPublicError(error);
    outcome = publicError.code;
    if (!(error instanceof McpPublicError)) {
      console.error(JSON.stringify({
        event: "mcp_request_error",
        operation: options.toolName,
        errorClass: "unexpected_error",
        requestId: options.requestId,
      }));
    }
    throw publicError;
  } finally {
    console.info(JSON.stringify({
      event: `mcp_${options.kind}`,
      operation: options.toolName,
      outcome,
      latencyMs: Math.round(performance.now() - startedAt),
      requestId: options.requestId,
      userHash,
    }));
  }
}

/** Applies the shared boundary and converts failures to resource/prompt protocol errors. */
export async function runMcpProtocolRequest<T extends object>(
  options: Omit<McpRequestOptions, "kind"> & { kind: "resource" | "prompt" },
  handler: (principal: ResolvedMcpPrincipal) => Promise<T>,
): Promise<T> {
  try {
    return await runMcpRequest(options, handler);
  } catch (error) {
    const publicError = toMcpPublicError(error);
    const challenge = publicError.code === "insufficient_scope"
      ? oauthChallenge(options.env, Array.isArray(options.requiredScope)
        ? options.requiredScope
        : [options.requiredScope], "insufficient_scope")
      : undefined;
    throw toMcpProtocolError(publicError, challenge);
  }
}

/**
 * Applies the MCP server's trust boundary, rate limits, output bound, and
 * privacy-safe operational logging around an individual read-only tool.
 */
export async function runMcpTool(
  options: McpToolOptions,
  handler: (principal: ResolvedMcpPrincipal) => Promise<McpToolValue>,
): Promise<CallToolResult> {
  try {
    return await runMcpRequest({ ...options, kind: "tool" }, async (principal) => (
      toToolResult(await handler(principal))
    ));
  } catch (error) {
    const publicError = toMcpPublicError(error);
    const challenge = publicError.code === "insufficient_scope"
      ? oauthChallenge(options.env, Array.isArray(options.requiredScope)
        ? options.requiredScope
        : [options.requiredScope], "insufficient_scope")
      : undefined;
    return toMcpErrorResult(publicError, challenge);
  }
}
