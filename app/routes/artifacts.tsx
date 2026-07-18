import { Apple } from "lucide-react";
import type { Route } from "./+types/artifacts";
import { EmptyState } from "~/components/empty-state";
import { PageHeader } from "~/components/shell/page-header";
import { Button } from "~/components/ui/button";
import { cloudflareContext } from "~/lib/context";
import { requireClubContext } from "~/lib/clubs.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Artifacts · Vibe Garden" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireClubContext(env, request, params.clubSlug ?? "");
  return null;
}

export default function Artifacts() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={Apple}
        title="Artifacts"
        description="Everything you make and upload: pages, prototypes, files, and experiments."
      />

      <EmptyState
        icon={Apple}
        title="No artifacts yet"
        description="When you build something in a project, or upload a file, it lands here. You decide what stays private and what goes to the gallery."
      >
        <Button variant="outline" disabled>
          Upload (coming soon)
        </Button>
      </EmptyState>
    </div>
  );
}
