import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "../app/lib/context";
import { assertWebsiteWriteOrigin } from "../app/lib/request-security.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/** The existing website handler, intentionally kept separate from MCP routing. */
export const reactRouterHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      assertWebsiteWriteOrigin(request, env);
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }

    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<Env>;
