import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Link2, LoaderCircle, PackageOpen, Plus, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { prepareArtifactSelection, suggestDataOrigins } from "~/lib/artifacts/package.client";
import { uploadPreparedPackage } from "~/lib/artifacts/upload.client";

export type ArtifactProject = { id: string; title: string; oneLiner?: string | null };
type Kind = "package" | "file" | "link";
type Step = "kind" | "project" | "metadata" | "progress";

function idempotencyKey(): string {
  return crypto.randomUUID();
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The artifact could not be saved. Please try again.";
}

export function ArtifactUploadDialog({
  projects,
  defaultProjectId,
  artifactId,
  artifactType,
  defaultTitle = "",
  defaultDescription = "",
  defaultOpen = false,
  triggerLabel = "Upload artifact",
  onCreated,
  onRefresh,
}: {
  projects: ArtifactProject[];
  defaultProjectId?: string;
  artifactId?: string;
  artifactType?: "html" | "file" | "link";
  defaultTitle?: string;
  defaultDescription?: string;
  defaultOpen?: boolean;
  triggerLabel?: string;
  onCreated?: (artifactId: string) => void;
  onRefresh?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [step, setStep] = useState<Step>(artifactId ? "metadata" : "kind");
  const [kind, setKind] = useState<Kind>(artifactType === "link" ? "link" : artifactType === "file" ? "file" : "package");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [seedProject, setSeedProject] = useState(false);
  const [seedTitle, setSeedTitle] = useState("");
  const [seedOneLiner, setSeedOneLiner] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [approvedOrigins, setApprovedOrigins] = useState<string[]>([]);
  const [originInput, setOriginInput] = useState("");
  const [progress, setProgress] = useState<{ completedFiles: number; totalFiles: number; completedBytes: number; totalBytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aborter = useRef<AbortController | null>(null);

  const selectedProject = projectId ? { projectId } : seedProject && seedTitle.trim()
    ? { projectDraft: { title: seedTitle.trim(), oneLiner: seedOneLiner.trim() } }
    : null;
  const needsOrigins = suggestions.some((origin) => !approvedOrigins.includes(origin));
  const canCreate = Boolean(selectedProject && title.trim() && (kind === "link" ? url.trim() : file) && !needsOrigins);
  const chosenOrigins = useMemo(() => approvedOrigins.filter(Boolean).sort(), [approvedOrigins]);

  useEffect(() => {
    if (kind !== "link" || !url.trim()) return;
    setSuggestions(suggestDataOrigins(url));
  }, [kind, url]);

  const discoverFileOrigins = async (next: File | null) => {
    setFile(next);
    setSuggestions([]);
    setApprovedOrigins([]);
    if (!next || kind === "file") return;
    try {
      setSuggestions(suggestDataOrigins(await next.text()));
    } catch {
      // A file remains uploadable; origin discovery is advisory only.
    }
  };

  const reset = () => {
    aborter.current?.abort();
    aborter.current = null;
    setStep(artifactId ? "metadata" : "kind");
    setKind(artifactType === "link" ? "link" : artifactType === "file" ? "file" : "package");
    setProjectId(defaultProjectId ?? "");
    setSeedProject(false);
    setSeedTitle("");
    setSeedOneLiner("");
    setTitle(defaultTitle);
    setDescription(defaultDescription);
    setUrl("");
    setFile(null);
    setSuggestions([]);
    setApprovedOrigins([]);
    setOriginInput("");
    setProgress(null);
    setError(null);
  };

  const submit = async () => {
    if (!canCreate || !selectedProject) return;
    setError(null);
    setStep("progress");
    const controller = new AbortController();
    aborter.current = controller;
    try {
      if (kind === "link") {
        const response = await fetch(artifactId ? `/api/artifacts/${encodeURIComponent(artifactId)}/link-version` : "/api/artifacts/links", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(artifactId
            ? { url: url.trim(), idempotencyKey: idempotencyKey() }
            : { project: selectedProject, title: title.trim(), ...(description.trim() ? { description: description.trim() } : {}), url: url.trim(), allowedDataOrigins: chosenOrigins, idempotencyKey: idempotencyKey() }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Artifact link failed (${response.status}).`);
        const result = await response.json() as { artifactId: string };
        onRefresh?.();
        setOpen(false);
        onCreated?.(result.artifactId);
        reset();
        return;
      }
      if (!file) return;
      const prepared = await prepareArtifactSelection(file);
      const result = await uploadPreparedPackage(prepared, {
        project: selectedProject,
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        allowedDataOrigins: chosenOrigins,
        idempotencyKey: idempotencyKey(),
        ...(artifactId ? { artifactId } : {}),
        signal: controller.signal,
        onProgress: setProgress,
      });
      onRefresh?.();
      setOpen(false);
      onCreated?.(result.artifactId);
      reset();
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setError("Upload cancelled. You can choose another file and try again.");
      } else {
        setError(messageFor(caught));
      }
      setStep("metadata");
    } finally {
      aborter.current = null;
    }
  };

  const addOrigin = () => {
    try {
      const origin = new URL(originInput.trim()).origin;
      if (origin.startsWith("https://") && !approvedOrigins.includes(origin)) setApprovedOrigins((origins) => [...origins, origin]);
      setOriginInput("");
    } catch {
      setError("Enter a complete HTTPS origin, such as https://data.example.com.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild><Button className="gap-1.5"><FileUp className="size-4" />{triggerLabel}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl" showCloseButton={step !== "progress"}>
        {step === "kind" && <>
          <DialogHeader><DialogTitle className="font-serif font-normal">What are you adding?</DialogTitle><DialogDescription>Start with the kind of artifact. You can choose its project next.</DialogDescription></DialogHeader>
          <div className="grid gap-2">
            <Button variant="outline" className="h-auto justify-start p-4 text-left" onClick={() => { setKind("package"); setStep("project"); }}><PackageOpen /> <span><strong>HTML or ZIP package</strong><br /><span className="font-normal text-muted-foreground">A small site, prototype, or interactive.</span></span></Button>
            <Button variant="outline" className="h-auto justify-start p-4 text-left" onClick={() => { setKind("file"); setStep("project"); }}><FileUp /> <span><strong>A file</strong><br /><span className="font-normal text-muted-foreground">A safe document or download.</span></span></Button>
            <Button variant="outline" className="h-auto justify-start p-4 text-left" onClick={() => { setKind("link"); setStep("project"); }}><Link2 /> <span><strong>A link</strong><br /><span className="font-normal text-muted-foreground">An external resource worth keeping.</span></span></Button>
          </div>
        </>}
        {step === "project" && <>
          <DialogHeader><DialogTitle className="font-serif font-normal">Choose a project</DialogTitle><DialogDescription>Artifacts stay with the project that grew them.</DialogDescription></DialogHeader>
          <div role="radiogroup" aria-label="Project" className="space-y-2">
            {projects.map((project) => <label key={project.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-accent/40"><input type="radio" name="project" checked={!seedProject && projectId === project.id} onChange={() => { setProjectId(project.id); setSeedProject(false); }} aria-label={project.title} /> <span>{project.title}</span></label>)}
            <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-accent/40"><input type="radio" name="project" checked={seedProject} onChange={() => { setProjectId(""); setSeedProject(true); }} /> <span className="flex items-center gap-1"><Plus className="size-3" /> Seed a new project</span></label>
          </div>
          {seedProject && <div className="grid gap-2"><Input aria-label="New project title" value={seedTitle} onChange={(event) => setSeedTitle(event.target.value)} placeholder="Project name" /><Input aria-label="New project one-liner" value={seedOneLiner} onChange={(event) => setSeedOneLiner(event.target.value)} placeholder="What is it for? (optional)" /></div>}
          <DialogFooter><Button variant="outline" onClick={() => setStep("kind")}>Back</Button><Button disabled={!selectedProject} onClick={() => setStep("metadata")}>Continue</Button></DialogFooter>
        </>}
        {step === "metadata" && <>
          <DialogHeader><DialogTitle className="font-serif font-normal">Describe it</DialogTitle><DialogDescription>Review any detected data origins before you create the artifact.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div><label htmlFor="artifact-title" className="mb-1 block text-sm">Title</label><Input id="artifact-title" value={title} onChange={(event) => setTitle(event.target.value)} required /></div>
            <div><label htmlFor="artifact-description" className="mb-1 block text-sm">Description</label><Textarea id="artifact-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} /></div>
            {kind === "link" ? <div><label htmlFor="artifact-url" className="mb-1 block text-sm">Link URL</label><Input id="artifact-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" required /></div> : <div><label htmlFor="artifact-file" className="mb-1 block text-sm">{kind === "package" ? "HTML or ZIP file" : "File"}</label><Input id="artifact-file" type="file" accept={kind === "package" ? ".html,.htm,.zip,text/html,application/zip" : undefined} onChange={(event) => void discoverFileOrigins(event.target.files?.[0] ?? null)} required /></div>}
            <fieldset className="rounded-md border p-3"><legend className="px-1 text-sm">Allowed data origins</legend><p className="mb-2 text-xs text-muted-foreground">Suggestions are unchecked until you, the owner, confirm they are allowed.</p>
              {suggestions.map((origin) => <label key={origin} className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={approvedOrigins.includes(origin)} onChange={(event) => setApprovedOrigins((origins) => event.target.checked ? [...origins, origin] : origins.filter((candidate) => candidate !== origin))} aria-label={`Allow ${new URL(origin).host}`} /> {origin}</label>)}
              {approvedOrigins.filter((origin) => !suggestions.includes(origin)).map((origin) => <div key={origin} className="mb-1 flex items-center gap-2 text-sm"><span>{origin}</span><button type="button" onClick={() => setApprovedOrigins((origins) => origins.filter((candidate) => candidate !== origin))} aria-label={`Remove ${origin}`}><X className="size-3" /></button></div>)}
              <div className="mt-2 flex gap-2"><Input aria-label="Additional data origin" value={originInput} onChange={(event) => setOriginInput(event.target.value)} placeholder="https://data.example.com" /><Button type="button" size="sm" variant="outline" onClick={addOrigin}>Add</Button></div>
            </fieldset>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>{!artifactId && <Button variant="outline" onClick={() => setStep("project")}>Back</Button>}<Button disabled={!canCreate} onClick={() => void submit()}>{artifactId ? "Upload new version" : "Create artifact"}</Button></DialogFooter>
        </>}
        {step === "progress" && <>
          <DialogHeader><DialogTitle className="font-serif font-normal">Saving your artifact</DialogTitle><DialogDescription>{progress ? `${progress.completedFiles} of ${progress.totalFiles} files uploaded` : "Preparing your upload…"}</DialogDescription></DialogHeader>
          <div className="flex items-center gap-3 rounded-md border p-4"><LoaderCircle className="size-5 animate-spin text-primary" /><span className="text-sm">{progress ? `${progress.completedBytes.toLocaleString()} of ${progress.totalBytes.toLocaleString()} bytes` : "Working safely…"}</span></div>
          <DialogFooter><Button variant="outline" onClick={() => aborter.current?.abort()}>Cancel upload</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  );
}
