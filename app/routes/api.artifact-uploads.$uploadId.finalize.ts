import type { Route } from "./+types/api.artifact-uploads.$uploadId.finalize";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactJson, artifactJsonAction } from "~/lib/artifacts/http.server";
import { finalizeUpload } from "~/lib/artifacts/service.server";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  return artifactJsonAction(async () => {
    if (!params.uploadId) throw new ArtifactError("invalid_input");
    return artifactJson(await finalizeUpload(env, user.id, params.uploadId));
  });
}
