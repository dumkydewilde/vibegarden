import { useRevalidator } from "react-router";
import type { Route } from "./+types/artifacts.$id";
import { ArtifactDetail } from "~/components/artifacts/artifact-detail";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";
import { getGalleryArtifact, getOwnedRecoverableArtifact, listOwnedArtifactVersions } from "~/lib/artifacts/service.server";
import { presentArtifactDetail, presentArtifactVersion } from "~/lib/artifacts/presenters.server";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.artifact.title ?? "Artifact"} · Vibe Garden` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  if (!params.id) throw new Response("Not found", { status: 404 });
  const owned = await getOwnedRecoverableArtifact(env, user.id, params.id);
  if (owned) {
    const versions = await listOwnedArtifactVersions(env, user.id, params.id);
    return { access: "owner" as const, artifact: presentArtifactDetail(owned), versions: (versions ?? []).map(presentArtifactVersion) };
  }
  const gallery = await getGalleryArtifact(env, params.id);
  if (!gallery) throw new Response("Not found", { status: 404 });
  return {
    access: "gallery" as const,
    artifact: {
      id: gallery.id,
      project: { id: "", title: gallery.projectTitle },
      title: gallery.title,
      description: gallery.description,
      type: gallery.type,
      visibility: "gallery" as const,
      currentVersion: gallery.version,
      galleryVersion: gallery.version,
      updatedAt: gallery.updatedAt,
      url: `/artifacts/${encodeURIComponent(gallery.id)}`,
      version: presentArtifactVersion(gallery.version),
    },
    versions: [],
  };
}

export default function ArtifactDetailRoute({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  return <div className="mx-auto max-w-3xl"><ArtifactDetail artifact={loaderData.artifact} access={loaderData.access} versions={loaderData.versions} onRefresh={() => revalidator.revalidate()} /></div>;
}
