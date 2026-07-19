import type { Route } from "./+types/api.artifacts.$artifactId.capability";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactJsonAction, artifactRejectMethod, artifactRequireMethod } from "~/lib/artifacts/http.server";
import { requireArtifactUser } from "~/lib/artifacts/auth.server";
import { cloudflareContext } from "~/lib/context";

/** Capability signing is deliberately owned by the isolated renderer boundary (Task 11). */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const methodError = artifactRequireMethod(request, "GET");
  if (methodError) return methodError;
  const { env } = context.get(cloudflareContext);
  const user = await requireArtifactUser(env, request);
  if (user instanceof Response) return user;
  return artifactJsonAction(async () => {
    if (!params.artifactId) throw new ArtifactError("invalid_input");
    // Never mint an unsigned or route-local renderer claim.
    throw new ArtifactError("not_found");
  });
}

export function action() {
  return artifactRejectMethod();
}
