import { Database, Newspaper } from "lucide-react";
import type { Route } from "./+types/inspiration";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Inspiration · Vibe Garden" }];
}

const datasets = [
  {
    title: "KNMI weather data",
    description:
      "Dutch weather observations going back decades. Good for dashboards, seasonal comparisons, or a rain-or-bike advisor.",
    tag: "Open data",
  },
  {
    title: "Amsterdam open geodata",
    description:
      "Neighborhoods, trees, parking, playgrounds. Everything in the city has coordinates, which makes for great map projects.",
    tag: "Open data",
  },
  {
    title: "Open Food Facts",
    description:
      "Ingredients and nutrition for over a million products. Scan a barcode, get data. A natural fit for photo-based tools.",
    tag: "Open data",
  },
] as const;

const stories = [
  {
    title: "The spreadsheet that answered back",
    description:
      "How a volunteer group turned a messy signup sheet into a small tool that answers questions in plain language.",
    tag: "Example",
  },
  {
    title: "A scanner for grandma's recipes",
    description:
      "Photos of handwritten recipe cards, turned into a searchable family cookbook over one weekend.",
    tag: "Example",
  },
] as const;

export default function Inspiration() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Inspiration"
        description="Datasets to play with and proof that ordinary people build useful things with AI."
      />

      <section>
        <h2 className="flex items-center gap-2 text-lg">
          <Database className="size-4 text-primary" />
          Datasets to start from
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {datasets.map((d) => (
            <Card key={d.title}>
              <CardHeader>
                <Badge variant="outline" className="mb-2 w-fit">
                  {d.tag}
                </Badge>
                <CardTitle className="font-serif text-base font-normal">
                  {d.title}
                </CardTitle>
                <CardDescription className="leading-relaxed">
                  {d.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="flex items-center gap-2 text-lg">
          <Newspaper className="size-4 text-primary" />
          Built by people like you
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {stories.map((s) => (
            <Card key={s.title}>
              <CardHeader>
                <Badge variant="outline" className="mb-2 w-fit">
                  {s.tag}
                </Badge>
                <CardTitle className="font-serif text-base font-normal">
                  {s.title}
                </CardTitle>
                <CardDescription className="leading-relaxed">
                  {s.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
