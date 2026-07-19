import type { User } from "~/db/schema";
import { requireUser } from "~/lib/auth.server";

/**
 * Keeps the global authentication redirect behavior intact while ensuring
 * every artifact route response, including unauthenticated redirects, is not
 * cacheable by the browser or an intermediary.
 */
export async function requireArtifactUser(env: Env, request: Request): Promise<User | Response> {
  try {
    return await requireUser(env, request);
  } catch (error) {
    if (error instanceof Response) {
      const headers = new Headers(error.headers);
      headers.set("Cache-Control", "private, no-store");
      return new Response(error.body, {
        status: error.status,
        statusText: error.statusText,
        headers,
      });
    }
    return Response.json(
      { error: "internal_error" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
