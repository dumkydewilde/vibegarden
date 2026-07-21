import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "../app/lib/context";
import { assertWebsiteWriteOrigin } from "../app/lib/request-security.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/** Handles website routes and returns an origin rejection before dispatch. */
export function handleReactRouterRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  try {
    assertWebsiteWriteOrigin(request, env);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env, ctx });
  return requestHandler(request, context);
}

/** The MCP wrapper uses the same guarded website handler for all web routes. */
export const reactRouterHandler = {
  fetch: handleReactRouterRequest,
} satisfies ExportedHandler<Env>;
