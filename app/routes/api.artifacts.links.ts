import type { Route } from "./+types/api.artifacts.links";
import { artifactJson, artifactJsonAction, readArtifactJson } from "~/lib/artifacts/http.server";
import { createLinkArtifact } from "~/lib/artifacts/service.server";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  return artifactJsonAction(async () => artifactJson(
    await createLinkArtifact(env, user.id, await readArtifactJson(request)),
    { status: 201 },
  ));
}
