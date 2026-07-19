import type { Route } from "./+types/api.artifact-uploads";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { requireArtifactUser } from "~/lib/artifacts/auth.server";
import { cloudflareContext } from "~/lib/context";
import { createUploadSession } from "~/lib/artifacts/service.server";
import { artifactJson, artifactJsonAction, artifactRequireMethod, readArtifactJson } from "~/lib/artifacts/http.server";

export async function action({ request, context }: Route.ActionArgs) {
  const methodError = artifactRequireMethod(request, "POST");
  if (methodError) return methodError;
  const { env } = context.get(cloudflareContext);
  const user = await requireArtifactUser(env, request);
  if (user instanceof Response) return user;
  return artifactJsonAction(async () => {
    const input = await readArtifactJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input) || "userId" in input) throw new ArtifactError("invalid_input");
    const session = await createUploadSession(env, user.id, input as never);
    return artifactJson(session, { status: 201 });
  });
}
