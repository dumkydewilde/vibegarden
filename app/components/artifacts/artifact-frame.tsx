import { useEffect, useState } from "react";

type CapabilityResponse = { url: string; expiresAt: number };

function isCapabilityResponse(value: unknown): value is CapabilityResponse {
  return typeof value === "object" && value !== null
    && typeof (value as Record<string, unknown>).url === "string"
    && Number.isSafeInteger((value as Record<string, unknown>).expiresAt);
}

export function ArtifactFrame({ artifactId, title, className }: { artifactId: string; title: string; className?: string }) {
  const [capability, setCapability] = useState<CapabilityResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      setFailed(false);
      try {
        const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/capability`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const value: unknown = response.ok ? await response.json() : null;
        if (!response.ok || !isCapabilityResponse(value)) throw new Error("Artifact preview is unavailable.");
        if (!active) return;
        setCapability(value);
        refresh = setTimeout(load, Math.max(0, (value.expiresAt - Math.floor(Date.now() / 1000) - 30) * 1000));
      } catch {
        if (active) setFailed(true);
      }
    };
    void load();
    return () => {
      active = false;
      if (refresh !== undefined) clearTimeout(refresh);
    };
  }, [artifactId]);

  if (failed) return <p role="alert" className="rounded-lg border p-4 text-sm text-muted-foreground">Preview unavailable. Try refreshing the page.</p>;
  if (!capability) return <p className="rounded-lg border p-4 text-sm text-muted-foreground">Loading preview…</p>;
  return <iframe title={`Preview: ${title}`} src={capability.url} sandbox="allow-scripts" className={className ?? "h-[32rem] w-full rounded-lg border bg-white"} />;
}
