import { useState } from "react";
import { Download, ExternalLink, File, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import type { ArtifactProject } from "./artifact-upload-dialog";
import { ArtifactUploadDialog } from "./artifact-upload-dialog";
import { ArtifactPublishControls } from "./artifact-publish-controls";
import { ArtifactVersionHistory, type ArtifactVersion } from "./artifact-version-history";

export type ArtifactDetailData = {
  id: string;
  project: ArtifactProject;
  title: string;
  description: string | null;
  type: "html" | "file" | "link";
  visibility: "private" | "gallery";
  deletedAt?: number | null;
  currentVersion: { id: string; number: number } | null;
  galleryVersion: { id: string; number: number } | null;
  version: ArtifactVersion & {
    entryPath: string | null;
    externalUrl: string | null;
    allowedDataOrigins: string[];
    fileCount: number;
    totalBytes: number;
    files: Array<{ path: string; mimeType: string; byteSize: number; sha256: string }>;
  };
};

function confirmation(message: string): boolean {
  return typeof window === "undefined" ? false : window.confirm(message);
}

async function artifactMutation(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Artifact action failed (${response.status}).`);
}

export function ArtifactDetail({
  artifact,
  access,
  versions = [],
  onRefresh,
  onDeleted,
}: {
  artifact: ArtifactDetailData;
  access: "owner" | "gallery";
  versions?: ArtifactVersion[];
  onRefresh?: () => void;
  onDeleted?: () => void;
}) {
  const owner = access === "owner";
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(artifact.title);
  const [description, setDescription] = useState(artifact.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(Boolean(artifact.deletedAt));
  const mutate = async (work: () => Promise<void>) => {
    setError(null);
    try { await work(); onRefresh?.(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Artifact action failed."); }
  };

  if (deleted) {
    return <section className="rounded-lg border border-dashed p-8 text-center"><h1 className="font-serif text-2xl">Artifact deleted</h1><p className="mt-2 text-sm text-muted-foreground">It can be recovered for 30 days.</p><Button className="mt-4" onClick={() => void mutate(async () => { if (!confirmation("Recover this artifact? It will return to your private collection.")) return; await artifactMutation(`/api/artifacts/${encodeURIComponent(artifact.id)}`, "POST", { intent: "restore-deleted" }); setDeleted(false); })}>Recover artifact</Button></section>;
  }

  return (
    <article>
      <Link to="/artifacts" className="text-sm text-muted-foreground hover:text-foreground">← Artifacts</Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div><p className="text-sm text-muted-foreground">{artifact.project.title}</p><h1 className="font-serif text-3xl">{artifact.title}</h1>{artifact.description && <p className="mt-2 max-w-2xl text-muted-foreground">{artifact.description}</p>}</div>
        {owner && <ArtifactUploadDialog projects={[artifact.project]} defaultProjectId={artifact.project.id} artifactId={artifact.id} artifactType={artifact.type} defaultTitle={artifact.title} defaultDescription={artifact.description ?? ""} triggerLabel="New version" onRefresh={onRefresh} />}
      </div>

      <section className="mt-6 rounded-lg border p-4" aria-labelledby="origins-heading">
        <h2 id="origins-heading" className="text-lg">Allowed data origins</h2>
        {artifact.version.allowedDataOrigins.length > 0 ? <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{artifact.version.allowedDataOrigins.map((origin) => <li key={origin}>{origin}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">This version does not declare external data origins.</p>}
      </section>

      <section className="mt-6 rounded-lg border p-4" aria-labelledby="artifact-content-heading">
        <h2 id="artifact-content-heading" className="text-lg">Artifact</h2>
        {artifact.version.externalUrl ? <a href={artifact.version.externalUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"><ExternalLink className="size-4" /> Open external link</a> : <div className="mt-3"><p className="text-sm text-muted-foreground">Files are downloaded separately; they are never rendered inline here.</p><ul className="mt-3 divide-y rounded-md border">{artifact.version.files.map((file) => <li key={file.path} className="flex items-center justify-between gap-3 px-3 py-2"><span className="flex min-w-0 items-center gap-2 text-sm"><File className="size-4 shrink-0" />{file.path}</span><span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground" aria-label={`Download ${file.path} unavailable until secure delivery is ready`}><Download className="size-3" /> Download unavailable</span></li>)}</ul></div>}
        {!owner && <p className="mt-4 text-sm text-muted-foreground">Shared in the gallery. You can view this saved version, but only its owner can edit or replace it.</p>}
      </section>

      {owner && <>
        <section className="mt-8 rounded-lg border p-4" aria-labelledby="metadata-heading"><div className="flex items-center justify-between gap-3"><h2 id="metadata-heading" className="text-lg">Metadata</h2><Button variant="outline" size="sm" onClick={() => setEditing((value) => !value)}><Pencil /> Edit metadata</Button></div>
          {editing && <div className="mt-3 grid gap-3"><Input aria-label="Artifact title" value={title} onChange={(event) => setTitle(event.target.value)} /><Textarea aria-label="Artifact description" value={description} onChange={(event) => setDescription(event.target.value)} /><div><Button onClick={() => void mutate(async () => { await artifactMutation(`/api/artifacts/${encodeURIComponent(artifact.id)}`, "PATCH", { title, description: description || null }); setEditing(false); })}>Save metadata</Button></div></div>}
        </section>
        <ArtifactPublishControls visibility={artifact.visibility} galleryVersionId={artifact.galleryVersion?.id ?? null} versions={versions} onShare={(versionId) => void mutate(async () => { if (!confirmation("Share this selected version with everyone in the gallery?")) return; await artifactMutation(`/api/artifacts/${encodeURIComponent(artifact.id)}/gallery`, "PUT", { versionId }); })} onUnshare={() => void mutate(async () => { if (!confirmation("Remove this artifact from the gallery? Gallery readers will lose access.")) return; await artifactMutation(`/api/artifacts/${encodeURIComponent(artifact.id)}/gallery`, "DELETE"); })} />
        <ArtifactVersionHistory versions={versions} currentVersionId={artifact.version.id} onRestore={(version) => void mutate(async () => { if (!confirmation(`Restore version ${version.number}? This changes the current private version.`)) return; await artifactMutation(`/api/artifacts/${encodeURIComponent(artifact.id)}/restore-version`, "POST", { versionId: version.id }); })} />
        <section className="mt-8 border-t pt-6"><Button variant="destructive" onClick={() => void mutate(async () => { if (!confirmation("Delete this artifact? It will be recoverable for 30 days.")) return; await artifactMutation(`/api/artifacts/${encodeURIComponent(artifact.id)}`, "DELETE"); setDeleted(true); onDeleted?.(); })}><Trash2 /> Delete artifact</Button></section>
      </>}
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </article>
  );
}
