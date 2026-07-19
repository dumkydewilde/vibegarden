import type { Route } from "./+types/api.artifacts.links";
import { artifactJson, artifactJsonAction, artifactRequireMethod, readArtifactJson } from "~/lib/artifacts/http.server";
import { createLinkArtifact } from "~/lib/artifacts/service.server";
import { requireArtifactUser } from "~/lib/artifacts/auth.server";
import { cloudflareContext } from "~/lib/context";

export async function action({ request, context }: Route.ActionArgs) {
  const methodError = artifactRequireMethod(request, "POST");
  if (methodError) return methodError;
  const { env } = context.get(cloudflareContext);
  const user = await requireArtifactUser(env, request);
  if (user instanceof Response) return user;
  return artifactJsonAction(async () => artifactJson(
    await createLinkArtifact(env, user.id, await readArtifactJson(request)),
    { status: 201 },
  ));
}
