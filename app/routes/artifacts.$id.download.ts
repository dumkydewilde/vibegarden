import type { Route } from "./+types/artifacts.$id.download";
import { ArtifactError } from "~/lib/artifacts/contracts";
import { artifactJsonAction, artifactRejectMethod, artifactRequireMethod } from "~/lib/artifacts/http.server";
import { requireArtifactUser } from "~/lib/artifacts/auth.server";
import { cloudflareContext } from "~/lib/context";
import { issueRendererCapability, resolveVisibleArtifact } from "~/lib/artifacts/renderer.server";

/**
 * The website authenticates and resolves access, then redirects to the isolated
 * renderer with a one-file download capability. It never streams R2 content.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const methodError = artifactRequireMethod(request, "GET");
  if (methodError) return methodError;
  const { env } = context.get(cloudflareContext);
  const user = await requireArtifactUser(env, request);
  if (user instanceof Response) return user;
  return artifactJsonAction(async () => {
    if (!params.id) throw new ArtifactError("not_found");
    const artifact = await resolveVisibleArtifact(env, user.id, params.id);
    if (!artifact || artifact.type !== "file") throw new ArtifactError("not_found");
    const requestedPath = new URL(request.url).searchParams.get("path");
    const entryPath = requestedPath ?? artifact.version.files[0]?.path;
    if (!entryPath) throw new ArtifactError("not_found");
    const capability = await issueRendererCapability(env, artifact, "download", entryPath);
    return new Response(null, { status: 302, headers: { Location: capability.url, "Cache-Control": "private, no-store" } });
  });
}

export function action() {
  return artifactRejectMethod();
}
