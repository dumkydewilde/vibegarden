import { Apple, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams, useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/artifacts";
import { ArtifactCard } from "~/components/artifacts/artifact-card";
import { ArtifactUploadDialog } from "~/components/artifacts/artifact-upload-dialog";
import { EmptyState } from "~/components/empty-state";
import { PageHeader } from "~/components/shell/page-header";
import { Button } from "~/components/ui/button";
import { requireUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";
import { requireClubContext } from "~/lib/clubs.server";
import { listOwnedArtifacts } from "~/lib/artifacts/service.server";
import { presentOwnedArtifact } from "~/lib/artifacts/presenters.server";
import { listProjects } from "~/lib/projects.server";
import { clubPath } from "~/lib/club-path";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Artifacts · Vibe Garden" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const scope = { clubId: club.club.id, userId: user.id };
  const [ownedArtifacts, ownedProjects] = await Promise.all([
    listOwnedArtifacts(env, user.id),
    listProjects(env, scope),
  ]);
  const projectIds = new Set(ownedProjects.map((project) => project.id));
  return {
    artifacts: ownedArtifacts
      .filter((artifact) => projectIds.has(artifact.projectId))
      .map((artifact) => ({
        ...presentOwnedArtifact(artifact),
        url: clubPath(club.club.slug, `artifacts/${encodeURIComponent(artifact.id)}`),
      })),
    projects: ownedProjects.map((project) => ({ id: project.id, title: project.title, oneLiner: project.oneLiner })),
  };
}

export default function Artifacts({ loaderData }: Route.ComponentProps) {
  const { artifacts, projects } = loaderData;
  const [showAll, setShowAll] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const groups = useMemo(() => {
    const byProject = new Map<string, { id: string; title: string; artifacts: typeof artifacts }>();
    for (const artifact of artifacts) {
      const existing = byProject.get(artifact.project.id);
      if (existing) existing.artifacts.push(artifact);
      else byProject.set(artifact.project.id, { id: artifact.project.id, title: artifact.project.title, artifacts: [artifact] });
    }
    return [...byProject.values()];
  }, [artifacts]);
  const visibleGroups = showAll ? groups : groups.slice(0, 6);
  const defaultProjectId = searchParams.get("project") ?? undefined;
  const { clubSlug } = useParams();
  const artifactPath = (id: string) => clubPath(clubSlug ?? "", `artifacts/${encodeURIComponent(id)}`);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={Apple}
        title="Artifacts"
        description="Everything you make and upload: pages, prototypes, files, and experiments."
      >
        <ArtifactUploadDialog projects={projects} defaultProjectId={defaultProjectId} defaultOpen={searchParams.get("upload") === "1"} onCreated={(id) => navigate(artifactPath(id))} onRefresh={() => revalidator.revalidate()} />
      </PageHeader>

      {groups.length === 0 ? <EmptyState icon={Apple} title="No artifacts yet" description="When you build something in a project, or upload a file, it lands here. You decide what stays private and what goes to the gallery.">
        <ArtifactUploadDialog projects={projects} defaultProjectId={defaultProjectId} defaultOpen={searchParams.get("upload") === "1"} onCreated={(id) => navigate(artifactPath(id))} onRefresh={() => revalidator.revalidate()} />
      </EmptyState> : <div className="space-y-8">
        {visibleGroups.map((group) => <section key={group.id} aria-labelledby={`artifact-project-${group.id}`}>
          <div className="mb-3 flex items-baseline justify-between gap-3"><h2 id={`artifact-project-${group.id}`} className="font-serif text-xl">{group.title}</h2><span className="text-xs text-muted-foreground">{group.artifacts.length} {group.artifacts.length === 1 ? "artifact" : "artifacts"}</span></div>
          <div className="grid gap-3 sm:grid-cols-2">{group.artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} />)}</div>
        </section>)}
        {groups.length > 6 && <Button variant="outline" className="w-full" onClick={() => setShowAll((value) => !value)}><ChevronDown className="size-4" /> {showAll ? "Show fewer projects" : `Show ${groups.length - 6} more project${groups.length - 6 === 1 ? "" : "s"}`}</Button>}
      </div>}
    </div>
  );
}
