import { Sprout } from "lucide-react";
import type { Route } from "./+types/garden";
import { EmptyState } from "~/components/empty-state";
import { useGardener } from "~/components/gardener/gardener-provider";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Idea Garden · Vibe Garden" }];
}

const modules = [
  "CSV file",
  "Google Sheet",
  "Photos or scans",
  "Dashboard",
  "Game",
  "Summarizer",
  "Content finder",
] as const;

export default function Garden() {
  const { setOpen } = useGardener();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Idea Garden"
        description="Your projects grow here. Start with a rough idea, or none at all: The Gardener helps you find one."
      />

      <EmptyState
        icon={Sprout}
        title="Nothing growing yet"
        description="Every project starts as a small idea. Brainstorm with The Gardener to find yours, then combine it with ready-made building blocks."
      >
        <Button size="lg" onClick={() => setOpen(true)}>
          Start brainstorming with The Gardener
        </Button>
      </EmptyState>

      <section className="mt-10">
        <h2 className="text-lg">Building blocks you can combine</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Projects here are mix-and-match. A few ingredients that plug into
          almost any idea:
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {modules.map((m) => (
            <Badge key={m} variant="secondary" className="px-3 py-1 text-sm">
              {m}
            </Badge>
          ))}
        </div>
      </section>
    </div>
  );
}
