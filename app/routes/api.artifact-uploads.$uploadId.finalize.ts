import type { Route } from "./+types/api.artifact-uploads.$uploadId.finalize";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactJson, artifactJsonAction, artifactRequireMethod } from "~/lib/artifacts/http.server";
import { finalizeUpload } from "~/lib/artifacts/service.server";
import { requireArtifactUser } from "~/lib/artifacts/auth.server";
import { cloudflareContext } from "~/lib/context";

export async function action({ request, params, context }: Route.ActionArgs) {
  const methodError = artifactRequireMethod(request, "POST");
  if (methodError) return methodError;
  const { env } = context.get(cloudflareContext);
  const user = await requireArtifactUser(env, request);
  if (user instanceof Response) return user;
  return artifactJsonAction(async () => {
    if (!params.uploadId) throw new ArtifactError("invalid_input");
    return artifactJson(await finalizeUpload(env, user.id, params.uploadId));
  });
}
