import { Images } from "lucide-react";
import type { Route } from "./+types/gallery";
import { EmptyState } from "~/components/empty-state";
import { PageHeader } from "~/components/shell/page-header";
import { GalleryCard } from "~/components/artifacts/gallery-card";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";
import { requireClubContext } from "~/lib/clubs.server";
import { listGalleryArtifacts } from "~/lib/artifacts/service.server";
import { presentGalleryArtifact } from "~/lib/artifacts/presenters.server";
import { clubPath } from "~/lib/club-path";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Gallery · Vibe Garden" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  return {
    artifacts: (await listGalleryArtifacts(env, club.club.id)).map((artifact) => ({
      ...presentGalleryArtifact(artifact),
      url: clubPath(club.club.slug, `artifacts/${encodeURIComponent(artifact.id)}`),
    })),
  };
}

export default function Gallery({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={Images}
        title="Gallery"
        description="What everyone else is growing. Borrow ideas freely, that is what it is for."
      />

      {loaderData.artifacts.length === 0 ? <EmptyState
        icon={Images}
        title="The gallery is still empty"
        description="As soon as someone shares an artifact from their own collection, it shows up here for everyone to see and learn from."
      /> : <div className="grid gap-3 sm:grid-cols-2">{loaderData.artifacts.map((artifact) => <GalleryCard key={artifact.id} artifact={artifact} />)}</div>}
    </div>
  );
}
