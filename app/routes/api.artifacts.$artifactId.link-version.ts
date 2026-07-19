import type { Route } from "./+types/api.artifacts.$artifactId.link-version";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactJson, artifactJsonAction, readArtifactJson } from "~/lib/artifacts/http.server";
import { createLinkArtifactVersion } from "~/lib/artifacts/service.server";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  return artifactJsonAction(async () => {
    if (!params.artifactId) throw new ArtifactError("invalid_input");
    const input = await readArtifactJson(request);
    if (
      !input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => key !== "url" && key !== "idempotencyKey")
    ) throw new ArtifactError("invalid_input");
    return artifactJson(await createLinkArtifactVersion(env, user.id, { ...input, artifactId: params.artifactId }), { status: 201 });
  });
}
