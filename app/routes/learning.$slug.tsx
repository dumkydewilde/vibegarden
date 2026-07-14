import { Link } from "react-router";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { Route } from "./+types/learning.$slug";
import { useGardener } from "~/components/gardener/gardener-provider";
import {
  ListItemWithAsk,
  ParagraphWithAsk,
} from "~/components/learning/paragraph-with-ask";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { getArticle, getArticleRaw } from "~/lib/content";

export function loader({ params }: Route.LoaderArgs) {
  if (!getArticle(params.slug)) {
    throw new Response("Article not found", { status: 404 });
  }
  return null;
}

export function meta({ params }: Route.MetaArgs) {
  const article = getArticle(params.slug);
  return [
    { title: `${article?.meta.title ?? "Article"} · Vibe Garden` },
    { name: "description", content: article?.meta.description ?? "" },
  ];
}

const mdxComponents = {
  li: ListItemWithAsk,
  p: ParagraphWithAsk,
};

export default function LearningArticle({ params }: Route.ComponentProps) {
  const article = getArticle(params.slug);
  const { addContext } = useGardener();
  if (!article) return null;

  const { meta } = article;

  const addArticleToContext = () => {
    const raw = getArticleRaw(meta.slug);
    if (raw) {
      addContext({ kind: "article", label: meta.title, content: raw });
    }
  };

  return (
    <div className="mx-auto max-w-[70ch] md:pl-10">
      <div className="mb-8">
        <Link
          to="/learning"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Learning
        </Link>
        <h1 className="mt-4 text-3xl leading-tight md:text-4xl">
          {meta.title}
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">{meta.description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{meta.category}</Badge>
          <Badge variant="outline">{meta.level}</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={addArticleToContext}
            className="ml-auto gap-1.5 text-muted-foreground"
          >
            <BookOpen className="size-3.5" />
            Discuss with The Gardener
          </Button>
        </div>
      </div>

      <article className="prose-garden pb-16">
        <article.Component components={mdxComponents} />
      </article>
    </div>
  );
}
