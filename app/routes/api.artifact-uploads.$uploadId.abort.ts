import type { Route } from "./+types/api.artifact-uploads.$uploadId.abort";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactEmpty, artifactJsonAction } from "~/lib/artifacts/http.server";
import { abortUpload } from "~/lib/artifacts/service.server";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  return artifactJsonAction(async () => {
    if (!params.uploadId) throw new ArtifactError("invalid_input");
    await abortUpload(env, user.id, params.uploadId);
    return artifactEmpty();
  });
}
