import { File, FileCode2, Link2 } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";

type GalleryCardData = {
  title: string;
  description: string | null;
  type: "html" | "file" | "link";
  project: { title: string };
  participant: { displayName: string };
  version: { number: number };
  url: string;
};

const typeDetails = {
  html: { label: "HTML", icon: FileCode2 },
  file: { label: "File", icon: File },
  link: { label: "Link", icon: Link2 },
} as const;

export function GalleryCard({ artifact }: { artifact: GalleryCardData }) {
  const detail = typeDetails[artifact.type];
  const Icon = detail.icon;
  return <Link to={artifact.url} className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/30">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm text-muted-foreground">{artifact.project.title}</p><h2 className="truncate font-medium">{artifact.title}</h2>{artifact.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{artifact.description}</p>}</div><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /></div>
    <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><Badge variant="outline">{detail.label}</Badge><Badge variant="outline">Version {artifact.version.number}</Badge><span className="ml-auto">By {artifact.participant.displayName}</span></div>
  </Link>;
}
