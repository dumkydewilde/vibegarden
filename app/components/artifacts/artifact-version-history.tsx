import { History, RotateCcw } from "lucide-react";
import { Button } from "~/components/ui/button";

export type ArtifactVersion = {
  id: string;
  number: number;
  source: "web" | "mcp";
  createdAt: number;
};

export function ArtifactVersionHistory({
  versions,
  currentVersionId,
  onRestore,
}: {
  versions: ArtifactVersion[];
  currentVersionId: string;
  onRestore: (version: ArtifactVersion) => void;
}) {
  if (versions.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby="version-history-heading">
      <h2 id="version-history-heading" className="flex items-center gap-2 text-lg"><History className="size-4 text-primary" /> Version history</h2>
      <ol className="mt-3 divide-y rounded-lg border">
        {versions.map((version) => <li key={version.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm">Version {version.number}{version.id === currentVersionId && <span className="ml-2 text-xs text-muted-foreground">Current</span>}</span>
          {version.id !== currentVersionId && <Button size="sm" variant="outline" onClick={() => onRestore(version)}><RotateCcw /> Restore version {version.number}</Button>}
        </li>)}
      </ol>
    </section>
  );
}
