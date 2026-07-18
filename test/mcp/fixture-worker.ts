import { createOAuthProvider } from "../../workers/oauth";

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
      const scope = grant.scope.filter((value) => value === "projects:read" || value === "content:read");
      const completed = await api.completeAuthorization({
        request: grant,
        userId,
        scope,
        metadata: {},
        props: { userId, scopes: scope },
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

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createOAuthProvider(env, defaultHandler).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
