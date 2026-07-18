import { reconcileClubAi } from "../app/lib/club-ai.server";
import { createOAuthProvider } from "./oauth";
import { reactRouterHandler } from "./react-router";

function unauthenticatedMcpChallenge(env: Env) {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource", env.APP_ORIGIN)}", scope="projects:read content:read"`,
    },
  });
}

async function purgeExpiredOauthData(env: Env) {
  const result = await createOAuthProvider(env, reactRouterHandler).purgeExpiredData(env, {
    batchSize: 100,
  });
  console.info(JSON.stringify({
    event: "mcp_oauth_purge",
    checked: result.grantsChecked + result.tokensChecked,
    purged: result.grantsPurged + result.tokensPurged,
  }));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const defaultHandler = {
      fetch(defaultRequest: Request, defaultEnv: Env, defaultCtx: ExecutionContext) {
        if (new URL(defaultRequest.url).pathname === new URL(env.MCP_RESOURCE_URL).pathname) {
          return unauthenticatedMcpChallenge(defaultEnv);
        }
        return reactRouterHandler.fetch(defaultRequest, defaultEnv, defaultCtx);
      },
    } satisfies ExportedHandler<Env>;
    return createOAuthProvider(env, defaultHandler).fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === "17 * * * *") {
      ctx.waitUntil(reconcileClubAi(env));
    }
    if (controller.cron === "17 3 * * *") {
      ctx.waitUntil(purgeExpiredOauthData(env));
    }
  },
} satisfies ExportedHandler<Env>;
