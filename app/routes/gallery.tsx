import { Images } from "lucide-react";
import type { Route } from "./+types/gallery";
import { EmptyState } from "~/components/empty-state";
import { PageHeader } from "~/components/shell/page-header";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Gallery · Vibe Garden" }];
}

export default function Gallery() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Gallery"
        description="What everyone else is growing. Borrow ideas freely, that is what it is for."
      />

      <EmptyState
        icon={Images}
        title="The gallery is still empty"
        description="As soon as someone shares an artifact from their own collection, it shows up here for everyone to see and learn from."
      />
    </div>
  );
}
