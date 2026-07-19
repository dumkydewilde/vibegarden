import { Link } from "react-router";
import type { Route } from "./+types/artifacts.$id.fullscreen";
import { ArtifactFrame } from "~/components/artifacts/artifact-frame";
import { requireUser } from "~/lib/auth.server";
import { resolveVisibleArtifact } from "~/lib/artifacts/renderer.server";
import { cloudflareContext } from "~/lib/context";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  if (!params.id) throw new Response("Not found", { status: 404 });
  const artifact = await resolveVisibleArtifact(env, user.id, params.id);
  if (!artifact || artifact.type !== "html") throw new Response("Not found", { status: 404 });
  return { id: artifact.id, title: artifact.title };
}

export default function ArtifactFullscreen({ loaderData }: Route.ComponentProps) {
  return <main className="flex min-h-screen flex-col p-4"><Link to={`/artifacts/${encodeURIComponent(loaderData.id)}`} className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">← Back to artifact</Link><ArtifactFrame artifactId={loaderData.id} title={loaderData.title} className="min-h-0 flex-1 w-full rounded-lg border bg-white" /></main>;
}
