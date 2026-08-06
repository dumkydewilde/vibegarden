import type { User } from "~/db/schema";
import { apiAuthorizationError } from "~/lib/api-errors";
import { proxyFetch, rateLimiter } from "~/lib/agents/fetch-guard.server";
import { requireUser } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import { cloudflareContext } from "~/lib/context";
import type { Route } from "./+types/api.fetch-proxy";

// Per isolate and best effort. Byte/time caps and club credentials are the real protection.
const limiter = rateLimiter();

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  let user: User;
  try {
    user = await requireUser(env, request);
    await requireClubContext(env, request, params.clubSlug ?? "");
  } catch (error) {
    return apiAuthorizationError(error);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("url" in raw) ||
    typeof raw.url !== "string"
  ) {
    return Response.json({ error: "A URL is required." }, { status: 400 });
  }

  if (!limiter.take(user.id)) {
    return Response.json(
      { error: "Too many fetches this minute. Give it a moment." },
      { status: 429 },
    );
  }

  const result = await proxyFetch(raw.url);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({
    status: result.status,
    contentType: result.contentType,
    body: result.body,
    totalChars: result.totalChars,
    truncated: result.truncated,
  });
}
