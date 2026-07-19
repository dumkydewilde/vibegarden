import type { Route } from "./+types/api.artifacts.$artifactId";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactEmpty, artifactJsonAction, readArtifactJson } from "~/lib/artifacts/http.server";
import { deleteArtifact, recoverArtifact, updateArtifactMetadata } from "~/lib/artifacts/service.server";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  return artifactJsonAction(async () => {
    if (!params.artifactId) throw new ArtifactError("invalid_input");
    if (request.method === "PATCH") {
      await updateArtifactMetadata(env, user.id, params.artifactId, await readArtifactJson(request));
      return artifactEmpty();
    }
    if (request.method === "DELETE") {
      await deleteArtifact(env, user.id, params.artifactId);
      return artifactEmpty();
    }
    if (request.method === "POST") {
      const input = await readArtifactJson(request);
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || input.intent !== "restore-deleted") throw new ArtifactError("invalid_input");
      await recoverArtifact(env, user.id, params.artifactId);
      return artifactEmpty();
    }
    throw new ArtifactError("invalid_input");
  });
}
