import type { Route } from "./+types/artifacts.$id.download";
import { artifactJson, artifactJsonAction, artifactRejectMethod, artifactRequireMethod } from "~/lib/artifacts/http.server";
import { getOwnedArtifact } from "~/lib/artifacts/service.server";
import { requireArtifactUser } from "~/lib/artifacts/auth.server";
import { cloudflareContext } from "~/lib/context";

/**
 * This website endpoint is intentionally capability-gated. Task 13 will turn
 * an authenticated owner request into a renderer-issued, short-lived download.
 * Until that boundary exists, it must not fall back to R2 or renderer URLs.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const methodError = artifactRequireMethod(request, "GET");
  if (methodError) return methodError;
  const { env } = context.get(cloudflareContext);
  const user = await requireArtifactUser(env, request);
  if (user instanceof Response) return user;
  return artifactJsonAction(async () => {
    if (!params.id || !await getOwnedArtifact(env, user.id, params.id)) {
      return artifactJson({ error: "not_found" }, { status: 404 });
    }
    return artifactJson({ error: "download_unavailable" }, { status: 503 });
  });
}

export function action() {
  return artifactRejectMethod();
}
