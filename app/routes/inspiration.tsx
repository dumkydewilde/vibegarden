import { useLoaderData } from "react-router";
import {
  BarChart3,
  Database,
  ExternalLink,
  Flower2,
  Newspaper,
  Sprout,
  Wrench,
} from "lucide-react";
import type { Route } from "./+types/inspiration";
import { useOptionalGardener } from "~/components/gardener/gardener-provider";
import { CommentDialog } from "~/components/comments/comment-dialog";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { requireUser } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import { isCommentTargetType, slugify } from "~/lib/comment-target";
import {
  createComment,
  deleteComment,
  listCommentsByType,
} from "~/lib/comments.server";
import { cloudflareContext } from "~/lib/context";
import {
  buildDatasetContext,
  datasets,
  type DatasetItem,
} from "~/lib/inspiration-datasets";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Inspiration · Vibe Garden" }];
}

type InspirationItem = {
  title: string;
  description: string;
  tag: string;
  href?: string;
};

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
    title: "Kids Games",
    description:
      "Six small browser games for kids, from spelling and maths to colouring and beginner coding. A playful example of a focused learning tool.",
    tag: "Example",
    href: "http://kids-games-50s.pages.dev/",
  },
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

/** Stable comment target ids for every card on the page, for validation. */
const inspirationTargetIds = new Set(
  [...stories, ...tools, ...examples, ...datasets].map((i) => slugify(i.title)),
);

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, "wotf");
  const commentsByTarget = await listCommentsByType(
    env,
    club.club.id,
    "inspiration",
    user.id,
  );
  return {
    commentsByTarget,
    canModerate: club.effectiveRole === "admin" || club.effectiveRole === "owner",
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, "wotf");
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "comment") {
    const targetType = form.get("targetType");
    const targetId = String(form.get("targetId") ?? "");
    // Only known cards on this page are valid targets.
    if (
      isCommentTargetType(targetType) &&
      targetType === "inspiration" &&
      inspirationTargetIds.has(targetId)
    ) {
      await createComment(env, { clubId: club.club.id, userId: user.id }, {
        targetType,
        targetId,
        body: String(form.get("body") ?? ""),
      });
    }
    return { ok: true };
  }
  if (intent === "delete-comment") {
    await deleteComment(env, { user, club }, String(form.get("commentId") ?? ""));
    return { ok: true };
  }
  return { ok: false };
}

/** Reads this route's comments and renders the discuss dialog for one card. */
function CardDiscussion({
  targetId,
  title,
}: {
  targetId: string;
  title: string;
}) {
  const { commentsByTarget, canModerate } = useLoaderData<typeof loader>();
  return (
    <CommentDialog
      targetType="inspiration"
      targetId={targetId}
      title={title}
      comments={commentsByTarget[targetId] ?? []}
      canModerate={canModerate}
    />
  );
}

function InspirationCard({ item }: { item: InspirationItem }) {
  return (
    <Card className="flex h-full flex-col">
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
      <CardFooter className="mt-auto flex-wrap gap-1">
        {item.href && (
          <Button asChild variant="outline" size="sm">
            <a
              href={item.href}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${item.title}`}
            >
              Open
              <ExternalLink />
            </a>
          </Button>
        )}
        <CardDiscussion targetId={slugify(item.title)} title={item.title} />
      </CardFooter>
    </Card>
  );
}

function DatasetCard({
  item,
  disabled,
  onAsk,
}: {
  item: DatasetItem;
  disabled: boolean;
  onAsk: () => void;
}) {
  return (
    <Card data-testid="dataset-card" className="h-full gap-4">
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
      <CardContent className="flex flex-wrap gap-1.5">
        {item.formats.map((format) => (
          <Badge key={format} variant="outline">
            {format}
          </Badge>
        ))}
        <Badge variant="secondary">{item.access}</Badge>
      </CardContent>
      <CardFooter className="mt-auto flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          aria-label={`Ask Gardener about ${item.title}`}
          onClick={onAsk}
        >
          <Sprout />
          Ask Gardener
        </Button>
        <Button asChild variant="outline" size="sm">
          <a
            href={item.docsUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Read the docs for ${item.title}`}
          >
            Read the docs
            <ExternalLink />
          </a>
        </Button>
        <CardDiscussion targetId={slugify(item.title)} title={item.title} />
      </CardFooter>
    </Card>
  );
}

function DatasetSection() {
  const gardener = useOptionalGardener();

  const askAbout = (item: DatasetItem) => {
    gardener?.askFresh(item.starterPrompt, [
      {
        kind: "dataset",
        label: item.title,
        content: buildDatasetContext(item),
      },
    ]);
  };

  return (
    <section>
      <h2 className="flex items-center gap-2 text-lg">
        <Database className="size-4 text-primary" />
        Datasets to start from
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {datasets.map((item) => (
          <DatasetCard
            key={item.title}
            item={item}
            disabled={!gardener || gardener.busy}
            onAsk={() => askAbout(item)}
          />
        ))}
      </div>
    </section>
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
        icon={Flower2}
        title="Inspiration"
        description="Datasets to play with and proof that ordinary people build useful things with AI."
      />

      <DatasetSection />

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
