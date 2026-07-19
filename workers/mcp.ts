import { WorkerTransport } from "agents/mcp";
import { z } from "zod";
import {
  fetchInput,
  freshReadsInput,
  getConversationInput,
  getProjectInput,
  listLearningContentInput,
  listProjectConversationsInput,
  listProjectsInput,
  searchInput,
  slugInput,
  type McpScope,
} from "../app/lib/mcp/contracts";
import { McpPublicError, toMcpErrorResult } from "../app/lib/mcp/errors.server";
import { oauthChallenge } from "../app/lib/mcp/auth.server";
import { parseKnowledgeId } from "../app/lib/mcp/compatibility.server";
import { createGardenerMcpServer } from "../app/lib/mcp/server.server";
import { runWithMcpRequestProps } from "../app/lib/mcp/request-context.server";

type RpcEnvelope = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: { name?: unknown; arguments?: unknown; uri?: unknown };
};

const toolRequirements = {
  list_projects: { schema: listProjectsInput, scope: "projects:read" },
  get_project: { schema: getProjectInput, scope: "projects:read" },
  list_project_conversations: { schema: listProjectConversationsInput, scope: "projects:read" },
  get_conversation: { schema: getConversationInput, scope: "projects:read" },
  list_learning_content: { schema: listLearningContentInput, scope: "content:read" },
  read_article: { schema: slugInput, scope: "content:read" },
  read_module: { schema: slugInput, scope: "content:read" },
  fresh_reads: { schema: freshReadsInput, scope: "content:read" },
  search: { schema: searchInput, scope: ["projects:read", "content:read"] },
  fetch: { schema: fetchInput, scope: ["projects:read", "content:read"] },
} as const;

export function mcpOriginAllowed(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set(env.MCP_ALLOWED_ORIGINS.split(",").map((value) => value.trim()));
  return allowed.has(origin);
}

export function mcpOriginRejectedResponse() {
  return new Response("Forbidden", { status: 403 });
}

function principalScopes(ctx: ExecutionContext): McpScope[] {
  const props = ctx.props as { scopes?: unknown } | undefined;
  if (!Array.isArray(props?.scopes)) return [];
  return props.scopes.filter((scope): scope is McpScope => (
    scope === "projects:read" || scope === "content:read"
  ));
}

function response(id: RpcEnvelope["id"], error: McpPublicError, challenge?: string, status = 200) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    result: toMcpErrorResult(error, challenge),
  }), { status, headers: { "Content-Type": "application/json" } });
}

function insufficientScopeResponse(
  id: RpcEnvelope["id"],
  env: Env,
  scopes: McpScope[],
) {
  const challenge = oauthChallenge(env, scopes, "insufficient_scope");
  const result = response(
    id,
    new McpPublicError("insufficient_scope", `This operation requires ${scopes.join(" ")}.`),
    challenge,
  );
  result.headers.set("WWW-Authenticate", challenge);
  return new Response(result.body, { status: 403, headers: result.headers });
}

function scopeForResource(uri: unknown): McpScope | undefined {
  if (typeof uri !== "string") return undefined;
  if (/^vibegarden:\/\/(?:project|conversation)\//.test(uri)) return "projects:read";
  if (/^vibegarden:\/\/(?:article|module)\//.test(uri) || uri === "vibegarden://guide/gardener") {
    return "content:read";
  }
  return undefined;
}

const continueProjectPromptInput = z.object({
  project_id: z.string().min(1).max(200),
}).strict();

function requestId(request: Request): Promise<RpcEnvelope["id"]> {
  return request.clone().json()
    .then((envelope: RpcEnvelope) => envelope.id)
    .catch(() => null);
}

function logTransportError(request: Request) {
  console.info(JSON.stringify({
    event: "mcp_transport_error",
    errorClass: "unexpected_error",
    method: request.method,
    path: new URL(request.url).pathname,
  }));
}

/**
 * Dispatch through the public transport API instead of createMcpHandler:
 * that helper logs raw caught errors through the isolate-global console. The
 * transport and request props are created per request, so concurrent calls do
 * not share server, logger, or authentication state.
 */
async function runSafeMcpTransport(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  const server = createGardenerMcpServer(env);
  const transport = new WorkerTransport();
  server.server.onerror = () => logTransportError(request);
  try {
    await server.connect(transport);
    const transportResponse = await runWithMcpRequestProps(
      (ctx.props ?? {}) as Record<string, unknown>,
      () => transport.handleRequest(request),
    );
    if (transportResponse.status < 500) return transportResponse;
    logTransportError(request);
    return response(
      await requestId(request),
      new McpPublicError("internal_error", "The request could not be completed."),
      undefined,
      500,
    );
  } catch {
    logTransportError(request);
    return response(
      await requestId(request),
      new McpPublicError("internal_error", "The request could not be completed."),
      undefined,
      500,
    );
  }
}

function hasRequiredScope(scopes: McpScope[], required: McpScope | McpScope[]) {
  const all = Array.isArray(required) ? required : [required];
  return all.some((scope) => scopes.includes(scope));
}

/**
 * Rejects malformed tool calls before the MCP SDK parses them, keeping Zod's
 * internal error detail off the wire. It only consumes a clone of the request.
 */
async function preflightMcpRequest(request: Request, env: Env, ctx: ExecutionContext) {
  if (request.method !== "POST" || !request.headers.get("Content-Type")?.includes("application/json")) {
    return undefined;
  }

  let envelope: RpcEnvelope;
  try {
    envelope = await request.clone().json() as RpcEnvelope;
  } catch {
    return undefined;
  }

  let required: McpScope | McpScope[] | undefined;
  if (envelope.method === "tools/call") {
    const name = typeof envelope.params?.name === "string" ? envelope.params.name : "";
    const tool = toolRequirements[name as keyof typeof toolRequirements];
    if (tool && !tool.schema.safeParse(envelope.params?.arguments).success) {
      return response(envelope.id, new McpPublicError("invalid_input", "The tool input is invalid."));
    }
    if (name === "fetch") {
      const parsedInput = fetchInput.parse(envelope.params?.arguments);
      try {
        const { kind } = parseKnowledgeId(parsedInput.id);
        required = kind === "project" || kind === "conversation"
          ? "projects:read"
          : "content:read";
      } catch (error) {
        if (error instanceof McpPublicError) return response(envelope.id, error);
        throw error;
      }
    } else {
      required = tool?.scope;
    }
  } else if (envelope.method === "resources/read") {
    required = scopeForResource(envelope.params?.uri);
  } else if (envelope.method === "prompts/get") {
    if (!continueProjectPromptInput.safeParse(envelope.params?.arguments).success) {
      return response(envelope.id, new McpPublicError("invalid_input", "The tool input is invalid."));
    }
    required = "projects:read";
  }

  if (required && !hasRequiredScope(principalScopes(ctx), required)) {
    const scopes = Array.isArray(required) ? required : [required];
    return insufficientScopeResponse(envelope.id, env, scopes);
  }
  return undefined;
}

export const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!mcpOriginAllowed(request, env)) return mcpOriginRejectedResponse();
    const preflightFailure = await preflightMcpRequest(request, env, ctx);
    if (preflightFailure) return preflightFailure;
    // A fresh server and transport are mandatory for stateless MCP dispatch.
    return runSafeMcpTransport(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
