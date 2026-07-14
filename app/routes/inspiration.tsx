import { BarChart3, Database, Newspaper, Wrench } from "lucide-react";
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

type InspirationItem = {
  title: string;
  description: string;
  tag: string;
  href?: string;
};

const datasets: InspirationItem[] = [
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
  {
    title: "Your Goodreads export",
    description:
      "Your whole reading life as one CSV: ratings, shelves, dates read. Raw material for a reading dashboard or a what-to-read-next advisor that actually knows your taste.",
    tag: "Personal data",
  },
  {
    title: "TalkData",
    description:
      "A searchable database of conference talks from the data world: speakers, topics, tools, events. Who talks about what, and how topics rise and fall over the years.",
    tag: "Open data",
    href: "https://talk-data.com/",
  },
];

const stories: InspirationItem[] = [
  {
    title: "Film dialogue, broken down by gender",
    description:
      "The Pudding analyzed 2,000 screenplays to count who actually gets to speak in Hollywood films. Text becomes data, data becomes a story everyone shared.",
    tag: "Data story",
    href: "https://pudding.cool/2017/03/film-dialogue/",
  },
  {
    title: "The Pudding",
    description:
      "Visual essays about culture, made from data: music, language, sports, film. The best answer to the question 'what can you even do with data?'",
    tag: "Data story",
    href: "https://pudding.cool/",
  },
  {
    title: "What football data analysis really means",
    description:
      "A grounded tour of how football clubs turn match data into decisions, and why the numbers only matter with context. A template for analyzing any sport you love.",
    tag: "Data story",
    href: "https://medium.com/@oussamamouss33/what-football-data-analysis-really-means-beyond-numbers-and-charts-26c3c011196c",
  },
];

const tools: InspirationItem[] = [
  {
    title: "Dot Collector",
    description:
      "Ray Dalio's meeting tool: everyone rates everyone's contributions in real time, and the dots add up to an honest picture of how a group thinks. A big idea you could rebuild small for your own club or team.",
    tag: "Tool",
    href: "https://www.principles.com/principles/3290232e-6bca-4585-a4f6-66874aefce30/",
  },
  {
    title: "Clay would've charged me $40,000",
    description:
      "One person rebuilt an expensive lead-collection product with Postgres, TypeScript, and Claude: about $225 in costs and 92 hours. The best writeup of what vibe-built software can replace.",
    tag: "Tool",
    href: "https://blog.dionis.me/p/clay-wouldve-charged-me-40000-i-spent",
  },
  {
    title: "FlickFlock",
    description:
      "Pick a few favourite films and shows, and it finds the people behind them, then what else those people made together. One clear idea, one public movie database, one weekend shape.",
    tag: "Tool",
    href: "https://flickflock.pages.dev/",
  },
  {
    title: "SelectFrom",
    description:
      "A job board for data work, filterable by city and tech stack. Proof that a focused niche site, one audience and one need, beats a general one you never finish.",
    tag: "Tool",
    href: "https://selectfrom.work/",
  },
];

const examples: InspirationItem[] = [
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
];

function InspirationCard({ item }: { item: InspirationItem }) {
  const card = (
    <Card
      className={
        item.href
          ? "h-full transition-colors group-hover:border-primary/40"
          : "h-full"
      }
    >
      <CardHeader>
        <Badge variant="outline" className="mb-2 w-fit">
          {item.tag}
        </Badge>
        <CardTitle className="font-serif text-base font-normal">
          {item.title}
        </CardTitle>
        <CardDescription className="leading-relaxed">
          {item.description}
        </CardDescription>
      </CardHeader>
    </Card>
  );

  if (!item.href) return card;
  return (
    <a href={item.href} target="_blank" rel="noreferrer" className="group">
      {card}
    </a>
  );
}

function InspirationSection({
  icon: Icon,
  title,
  items,
  columns = "sm:grid-cols-2 lg:grid-cols-3",
  className,
}: {
  icon: typeof Database;
  title: string;
  items: readonly InspirationItem[];
  columns?: string;
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="flex items-center gap-2 text-lg">
        <Icon className="size-4 text-primary" />
        {title}
      </h2>
      <div className={`mt-4 grid gap-4 ${columns}`}>
        {items.map((item) => (
          <InspirationCard key={item.title} item={item} />
        ))}
      </div>
    </section>
  );
}

export default function Inspiration() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Inspiration"
        description="Datasets to play with and proof that ordinary people build useful things with AI."
      />

      <InspirationSection
        icon={Database}
        title="Datasets to start from"
        items={datasets}
      />

      <InspirationSection
        icon={BarChart3}
        title="Data stories to learn from"
        items={stories}
        className="mt-12"
      />

      <InspirationSection
        icon={Wrench}
        title="Tools people built"
        items={tools}
        columns="sm:grid-cols-2"
        className="mt-12"
      />

      <InspirationSection
        icon={Newspaper}
        title="Built by people like you"
        items={examples}
        columns="sm:grid-cols-2"
        className="mt-12"
      />
    </div>
  );
}
