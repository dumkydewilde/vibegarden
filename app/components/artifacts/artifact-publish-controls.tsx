import { useState } from "react";
import { Eye, EyeOff, Share2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { ArtifactVersion } from "./artifact-version-history";

export function ArtifactPublishControls({
  visibility,
  galleryVersionId,
  versions,
  onShare,
  onUnshare,
}: {
  visibility: "private" | "gallery";
  galleryVersionId: string | null;
  versions: ArtifactVersion[];
  onShare: (versionId: string) => void;
  onUnshare: () => void;
}) {
  const [versionId, setVersionId] = useState(galleryVersionId ?? versions[0]?.id ?? "");
  return (
    <section className="mt-8 rounded-lg border p-4" aria-labelledby="gallery-controls-heading">
      <h2 id="gallery-controls-heading" className="flex items-center gap-2 text-lg"><Share2 className="size-4 text-primary" /> Gallery sharing</h2>
      <p className="mt-1 text-sm text-muted-foreground">Choose the exact retained version readers can see. Sharing is visible to everyone in the gallery.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="gallery-version">Gallery version</label>
        <select id="gallery-version" value={versionId} onChange={(event) => setVersionId(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
          {versions.map((version) => <option key={version.id} value={version.id}>Version {version.number}</option>)}
        </select>
        <Button disabled={!versionId} onClick={() => onShare(versionId)}><Eye /> {visibility === "gallery" ? "Update gallery version" : "Share selected version"}</Button>
        {visibility === "gallery" && <Button variant="outline" onClick={onUnshare}><EyeOff /> Remove from gallery</Button>}
      </div>
    </section>
  );
}
