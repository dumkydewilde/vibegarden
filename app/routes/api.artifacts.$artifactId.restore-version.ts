import type { Route } from "./+types/api.artifacts.$artifactId.restore-version";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactEmpty, artifactJsonAction, artifactRequireMethod, readArtifactJson } from "~/lib/artifacts/http.server";
import { restoreArtifactVersion } from "~/lib/artifacts/service.server";
import { requireArtifactUser } from "~/lib/artifacts/auth.server";
import { cloudflareContext } from "~/lib/context";

export async function action({ request, params, context }: Route.ActionArgs) {
  const methodError = artifactRequireMethod(request, "POST");
  if (methodError) return methodError;
  const { env } = context.get(cloudflareContext);
  const user = await requireArtifactUser(env, request);
  if (user instanceof Response) return user;
  return artifactJsonAction(async () => {
    if (!params.artifactId) throw new ArtifactError("invalid_input");
    const input = await readArtifactJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.versionId !== "string" || !input.versionId) throw new ArtifactError("invalid_input");
    await restoreArtifactVersion(env, user.id, params.artifactId, input.versionId);
    return artifactEmpty();
  });
}
