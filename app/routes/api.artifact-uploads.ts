import type { Route } from "./+types/api.artifact-uploads";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";
import { createUploadSession } from "~/lib/artifacts/service.server";
import { artifactJson, artifactJsonAction, readArtifactJson } from "~/lib/artifacts/http.server";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  return artifactJsonAction(async () => {
    const input = await readArtifactJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input) || "userId" in input) throw new ArtifactError("invalid_input");
    const session = await createUploadSession(env, user.id, input as never);
    return artifactJson(session, { status: 201 });
  });
}
