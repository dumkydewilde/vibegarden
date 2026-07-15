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
      "Dutch weather observations since 1901. Compare seasons, find the best terrace weather, or build a rain-or-bike advisor.",
    tag: "Open data",
    href: "https://dataplatform.knmi.nl/en/dataset/daily-in-situ-meteorological-observations-validated-1-0",
  },
  {
    title: "Amsterdam open geodata",
    description:
      "Neighborhoods, trees, parking, playgrounds. Everything in the city has coordinates, which makes for great map projects.",
    tag: "Open data",
    href: "https://maps.amsterdam.nl/open_geodata/",
  },
  {
    title: "Open Food Facts",
    description:
      "Ingredients and nutrition for millions of products. Compare supermarket shelves, flag allergens, or build a barcode-scanning lunch helper.",
    tag: "Open data",
    href: "https://world.openfoodfacts.org/data",
  },
  {
    title: "Your Goodreads export",
    description:
      "Your reading life as one CSV: ratings, shelves, and dates read. Build a reading dashboard or a recommender that actually knows your taste.",
    tag: "Personal data",
    href: "https://www.goodreads.com/review/import",
  },
  {
    title: "TalkData",
    description:
      "A searchable database of data conference talks: speakers, topics, tools, and events. See who talks about what and how themes rise and fall.",
    tag: "Open data",
    href: "https://talk-data.com/",
  },
  {
    title: "CBS StatLine",
    description:
      "Population, housing, income, health, mobility, and more from Statistics Netherlands. Compare neighborhoods or test claims about how the country is changing.",
    tag: "Open data",
    href: "https://www.cbs.nl/en-gb/our-services/open-data/statline-as-open-data",
  },
  {
    title: "Your Spotify history",
    description:
      "A JSON record of songs and podcasts from the lifetime of your account. Map eras in your taste, measure skips, or plan a group playlist.",
    tag: "Personal data",
    href: "https://support.spotify.com/us/article/data-rights-and-privacy-settings/",
  },
  {
    title: "Your Strava archive",
    description:
      "Routes, distances, times, and activity files from your own account. Draw a personal heatmap, find neglected rides, or design a club route.",
    tag: "Personal data",
    href: "https://support.strava.com/en-us/articles/15401919-exporting-your-data-and-bulk-export",
  },
  {
    title: "Stack Overflow Developer Survey",
    description:
      "Annual survey data from developers around the world. Explore salaries, tools, AI attitudes, or which technologies people admire but avoid using.",
    tag: "Open data",
    href: "https://survey.stackoverflow.co/",
  },
  {
    title: "iNaturalist observations",
    description:
      "Geotagged wildlife sightings shared by a global community. Map city biodiversity, track the seasons, or make a nature-walk companion.",
    tag: "Open data",
    href: "https://www.inaturalist.org/pages/developers",
  },
  {
    title: "Dutch election results",
    description:
      "Results from national, local, European, and water-board elections, with history back to 1848. Map turnout or show how places shift over time.",
    tag: "Open data",
    href: "https://www.verkiezingsuitslagen.nl/",
  },
  {
    title: "Luchtmeetnet air quality",
    description:
      "Hourly readings for particulate matter, nitrogen dioxide, ozone, and more across the Netherlands. Find cleaner times to run, ride, or open the windows.",
    tag: "Open data",
    href: "https://api-docs.luchtmeetnet.nl/",
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
