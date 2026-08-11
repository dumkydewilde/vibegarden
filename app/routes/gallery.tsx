import { Images } from "lucide-react";
import type { Route } from "./+types/gallery";
import { EmptyState } from "~/components/empty-state";
import { PageHeader } from "~/components/shell/page-header";
import { GalleryCard } from "~/components/artifacts/gallery-card";
import { McpConnectCard } from "~/components/mcp/mcp-connect-card";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";
import { requireClubContext } from "~/lib/clubs.server";
import { listGalleryArtifacts } from "~/lib/artifacts/service.server";
import { presentGalleryArtifact } from "~/lib/artifacts/presenters.server";
import { clubPath } from "~/lib/club-path";
import { mcpServerUrl } from "~/lib/mcp/public-url";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Gallery · Vibe Garden" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  return {
    mcpUrl: mcpServerUrl(env.APP_ORIGIN),
    artifacts: (await listGalleryArtifacts(env, club.club.id)).map((artifact) => {
      const presented = presentGalleryArtifact(artifact);
      return {
        ...presented,
        url: artifact.type === "link" && artifact.externalUrl
          ? artifact.externalUrl
          : clubPath(club.club.slug, `artifacts/${encodeURIComponent(artifact.id)}`),
      };
    }),
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

      <McpConnectCard
        className="mb-8"
        serverUrl={loaderData.mcpUrl}
        title="Share to the gallery from Claude, ChatGPT, or Gemini"
        description="Connect Vibe Garden as an MCP server and your chat app can build an artifact and put it here for the club, after you confirm."
        lastStep="Ask your chat app to share an artifact to the gallery. It asks you to confirm the exact version before anything becomes visible here."
      />

      {loaderData.artifacts.length === 0 ? <EmptyState
        icon={Images}
        title="The gallery is still empty"
        description="As soon as someone shares an artifact from their own collection, it shows up here for everyone to see and learn from."
      /> : <div className="grid gap-3 sm:grid-cols-2">{loaderData.artifacts.map((artifact) => <GalleryCard key={artifact.id} artifact={artifact} />)}</div>}
    </div>
  );
}
