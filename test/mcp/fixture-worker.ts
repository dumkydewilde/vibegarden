import { createOAuthProvider, isOAuthProviderPath } from "../../workers/oauth";
import { mcpOriginAllowed, mcpOriginRejectedResponse } from "../../workers/mcp";

function unauthenticatedMcpChallenge(env: Env) {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource", env.APP_ORIGIN)}", scope="projects:read content:read"`,
    },
  });
}

const defaultHandler = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const api = env.OAUTH_PROVIDER;
    if (url.pathname === "/authorize") {
      const grant = await api.parseAuthRequest(request);
      if (grant.resource !== env.MCP_RESOURCE_URL) {
        return new Response("Invalid OAuth resource", { status: 400 });
      }
      const userId = request.headers.get("x-test-user-id") || "test-user";
      const clubId = request.headers.get("x-test-club-id") || "test-club";
      const scope = grant.scope.filter((value) => value === "projects:read" || value === "content:read");
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO users (id, email, name, role, stage, created_at) VALUES (?, ?, 'OAuth test user', 'user', 'exploring', ?)",
        ).bind(userId, `${userId}@example.test`, now),
        env.DB.prepare(
          "INSERT OR IGNORE INTO clubs (id, name, slug, model_policy, status, created_by, created_at, updated_at) VALUES (?, 'OAuth test club', ?, 'all_models', 'active', ?, ?, ?)",
        ).bind(clubId, clubId, userId, now, now),
        env.DB.prepare(
          "INSERT OR IGNORE INTO club_memberships (club_id, user_id, role, onboarding_stage, joined_at, updated_at) VALUES (?, ?, 'member', 'exploring', ?, ?)",
        ).bind(clubId, userId, now, now),
      ]);
      const completed = await api.completeAuthorization({
        request: grant,
        userId,
        scope,
        metadata: {},
        props: { userId, clubId, scopes: scope },
      });
      return Response.redirect(completed.redirectTo, 302);
    }
    if (url.pathname === "/test/revoke") {
      const userId = request.headers.get("x-test-user-id") || "test-user";
      const grants = await api.listUserGrants(userId);
      if (grants.items[0]) await api.revokeGrant(grants.items[0].id, userId);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === new URL(env.MCP_RESOURCE_URL).pathname) return unauthenticatedMcpChallenge(env);
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Workerd enforces Cloudflare KV's 60-second storage minimum. The provider
 * still writes and validates its own one-second `expiresAt` value, so this
 * fixture only retains that record long enough for the real expiry check.
 */
function retainOneSecondTokenRecord(kv: KVNamespace): KVNamespace {
  return new Proxy(kv, {
    get(target, property, receiver) {
      if (property === "put") {
        return (key: string, value: string | ReadableStream | ArrayBuffer | ArrayBufferView, options?: KVNamespacePutOptions) => (
          target.put(key, value, options?.expirationTtl === 1
            ? { ...options, expirationTtl: 60 }
            : options)
        );
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as KVNamespace;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const pathname = new URL(request.url).pathname;
    const mcpPath = new URL(env.MCP_RESOURCE_URL).pathname;
    if (pathname === mcpPath && !mcpOriginAllowed(request, env)) {
      return mcpOriginRejectedResponse();
    }
    if (!isOAuthProviderPath(pathname, env)) {
      return defaultHandler.fetch(request, env, ctx);
    }
    const expiresInOneSecond = request.headers.get("x-test-access-token-ttl") === "1";
    const providerEnv = expiresInOneSecond
      ? { ...env, OAUTH_KV: retainOneSecondTokenRecord(env.OAUTH_KV) }
      : env;
    // Workerd loads local .dev.vars for this fixture. Remove the optional
    // production secret so the runtime suite can prove the catalog is safe
    // when fresh_reads is not configured.
    const mcpEnv = new Proxy(providerEnv, {
      get(target, property, receiver) {
        if (property === "MOTHERDUCK_TOKEN") return undefined;
        return Reflect.get(target, property, receiver);
      },
    }) as Env;
    return createOAuthProvider(
      mcpEnv,
      defaultHandler,
      expiresInOneSecond ? { accessTokenTTL: 1 } : undefined,
    ).fetch(request, mcpEnv, ctx);
  },
} satisfies ExportedHandler<Env>;
