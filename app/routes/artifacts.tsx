import { Archive } from "lucide-react";
import type { Route } from "./+types/artifacts";
import { EmptyState } from "~/components/empty-state";
import { PageHeader } from "~/components/shell/page-header";
import { Button } from "~/components/ui/button";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Artifacts · Vibe Garden" }];
}

export default function Artifacts() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Artifacts"
        description="Everything you make and upload: pages, prototypes, files, and experiments."
      />

      <EmptyState
        icon={Archive}
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
