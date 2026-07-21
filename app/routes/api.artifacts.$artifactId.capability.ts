import type { Route } from "./+types/api.artifacts.$artifactId.capability";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactJson, artifactJsonAction, artifactRejectMethod, artifactRequireMethod } from "~/lib/artifacts/http.server";
import { requireArtifactUser } from "~/lib/artifacts/auth.server";
import { cloudflareContext } from "~/lib/context";
import { issueRendererCapability, resolveVisibleArtifact } from "~/lib/artifacts/renderer.server";

/** Capability signing is deliberately owned by the isolated renderer boundary (Task 11). */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const methodError = artifactRequireMethod(request, "GET");
  if (methodError) return methodError;
  const { env } = context.get(cloudflareContext);
  const user = await requireArtifactUser(env, request);
  if (user instanceof Response) return user;
  return artifactJsonAction(async () => {
    if (!params.artifactId) throw new ArtifactError("invalid_input");
    const artifact = await resolveVisibleArtifact(env, user.id, params.artifactId);
    if (!artifact || artifact.type === "link") throw new ArtifactError("not_found");
    if (artifact.type !== "html" || !artifact.version.entryPath) throw new ArtifactError("invalid_type");
    return artifactJson(await issueRendererCapability(env, artifact, "preview", artifact.version.entryPath));
  });
}

export function action() {
  return artifactRejectMethod();
}
