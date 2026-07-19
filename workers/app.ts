import { reconcileClubAi } from "../app/lib/club-ai.server";
import { cleanupArtifacts } from "../app/lib/artifacts/cleanup.server";
import { recordArtifactEvent, writeArtifactMetric } from "../app/lib/artifacts/observability.server";
import { createOAuthProvider, isOAuthProviderPath } from "./oauth";
import { mcpOriginAllowed, mcpOriginRejectedResponse } from "./mcp";
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

async function runArtifactCleanup(env: Env): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await cleanupArtifacts(env, startedAt);
    const count = Object.values(result).reduce((total, category) => total + category.deleted, 0);
    const bytes = Object.values(result).reduce((total, category) => total + category.bytes, 0);
    const failures = Object.values(result).reduce((total, category) => total + category.failed, 0);
    const event = {
      operation: "scheduled_artifact_cleanup",
      count,
      bytes,
      durationMs: Date.now() - startedAt,
      outcome: failures > 0 ? "partial_failure" : "complete",
      ...(failures > 0 ? { errorCode: "storage_unavailable" } : {}),
    };
    recordArtifactEvent(event);
    writeArtifactMetric(env, event);
  } catch (error) {
    const event = {
      operation: "scheduled_artifact_cleanup",
      count: 0,
      bytes: 0,
      durationMs: Date.now() - startedAt,
      outcome: "failed",
      errorCode: "internal",
    };
    recordArtifactEvent(event);
    writeArtifactMetric(env, event);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const pathname = new URL(request.url).pathname;
    const mcpPath = new URL(env.MCP_RESOURCE_URL).pathname;
    // OAuthProvider treats apiRoute as a prefix. Enforce the exact protected
    // route before it can reflect Origin or authenticate a nested website URL.
    if (pathname === mcpPath && !mcpOriginAllowed(request, env)) {
      return mcpOriginRejectedResponse();
    }
    if (!isOAuthProviderPath(pathname, env)) {
      return reactRouterHandler.fetch(request, env, ctx);
    }
    const defaultHandler = {
      fetch(defaultRequest: Request, defaultEnv: Env, defaultCtx: ExecutionContext) {
        if (new URL(defaultRequest.url).pathname === mcpPath) {
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
    if (controller.cron === "23 3 * * *") {
      ctx.waitUntil(runArtifactCleanup(env));
    }
  },
} satisfies ExportedHandler<Env>;
