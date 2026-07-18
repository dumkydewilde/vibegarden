import { createMcpHandler } from "agents/mcp";
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
import { createGardenerMcpServer } from "../app/lib/mcp/server.server";

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

function originAllowed(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set(env.MCP_ALLOWED_ORIGINS.split(",").map((value) => value.trim()));
  return allowed.has(origin);
}

function principalScopes(ctx: ExecutionContext): McpScope[] {
  const props = ctx.props as { scopes?: unknown } | undefined;
  if (!Array.isArray(props?.scopes)) return [];
  return props.scopes.filter((scope): scope is McpScope => (
    scope === "projects:read" || scope === "content:read"
  ));
}

function response(id: RpcEnvelope["id"], error: McpPublicError, challenge?: string) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    result: toMcpErrorResult(error, challenge),
  }), { headers: { "Content-Type": "application/json" } });
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

function scopeForFetch(id: unknown): McpScope | McpScope[] | undefined {
  if (typeof id !== "string") return undefined;
  if (/^(?:project|conversation):/.test(id)) return "projects:read";
  if (/^(?:article|module|guide):/.test(id)) return "content:read";
  return ["projects:read", "content:read"];
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
    required = name === "fetch"
      ? scopeForFetch((envelope.params?.arguments as { id?: unknown } | undefined)?.id)
      : tool?.scope;
  } else if (envelope.method === "resources/read") {
    required = scopeForResource(envelope.params?.uri);
  } else if (envelope.method === "prompts/get") {
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
    if (!originAllowed(request, env)) return new Response("Forbidden", { status: 403 });
    const preflightFailure = await preflightMcpRequest(request, env, ctx);
    if (preflightFailure) return preflightFailure;
    // A fresh server is mandatory: the stateless transport allows one connection per server.
    const server = createGardenerMcpServer(env);
    return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
