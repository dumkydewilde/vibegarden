import { Link } from "react-router";
import { File, FileCode2, Link2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";

export type ArtifactCardData = {
  id: string;
  title: string;
  description: string | null;
  type: "html" | "file" | "link";
  visibility: "private" | "gallery";
  currentVersion: { number: number } | null;
  updatedAt: number;
  url: string;
};

const typeDetails = {
  html: { label: "HTML", icon: FileCode2 },
  file: { label: "File", icon: File },
  link: { label: "Link", icon: Link2 },
} as const;

function relativeUpdate(timestamp: number): string {
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  return `Updated ${days} days ago`;
}

export function ArtifactCard({ artifact }: { artifact: ArtifactCardData }) {
  const detail = typeDetails[artifact.type];
  const Icon = detail.icon;
  return (
    <Link
      to={artifact.url}
      className="group block rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium group-hover:text-primary">{artifact.title}</h3>
          {artifact.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{artifact.description}</p>}
        </div>
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline" aria-label={`Artifact type: ${detail.label}`}>{detail.label}</Badge>
        {artifact.currentVersion && <Badge variant="outline" aria-label={`Current version ${artifact.currentVersion.number}`}>Version {artifact.currentVersion.number}</Badge>}
        <Badge variant="outline" aria-label={`Visibility: ${artifact.visibility}`}>{artifact.visibility === "gallery" ? "Gallery" : "Private"}</Badge>
        <span className="ml-auto">{relativeUpdate(artifact.updatedAt)}</span>
      </div>
    </Link>
  );
}
