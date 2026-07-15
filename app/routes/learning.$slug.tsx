import { Link } from "react-router";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { Route } from "./+types/learning.$slug";
import { useGardener } from "~/components/gardener/gardener-provider";
import { ContentLink } from "~/components/content-link";
import { MdxPre } from "~/components/mermaid-block";
import { CommentThread } from "~/components/comments/comment-thread";
import {
  ListItemWithAsk,
  ParagraphWithAsk,
} from "~/components/learning/paragraph-with-ask";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { requireUser } from "~/lib/auth.server";
import {
  createComment,
  deleteComment,
  listComments,
} from "~/lib/comments.server";
import { getArticle, getArticleRaw } from "~/lib/content";
import { cloudflareContext } from "~/lib/context";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!getArticle(params.slug)) {
    throw new Response("Article not found", { status: 404 });
  }
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const comments = await listComments(env, "article", params.slug, user.id);
  return { comments, canModerate: user.role === "admin" };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "comment") {
    // Target is fixed by the route, not trusted from the form.
    await createComment(env, user.id, {
      targetType: "article",
      targetId: params.slug,
      body: String(form.get("body") ?? ""),
    });
    return { ok: true };
  }
  if (intent === "delete-comment") {
    await deleteComment(env, user, String(form.get("commentId") ?? ""));
    return { ok: true };
  }
  return { ok: false };
}

export function meta({ params }: Route.MetaArgs) {
  const article = getArticle(params.slug);
  return [
    { title: `${article?.meta.title ?? "Article"} · Vibe Garden` },
    { name: "description", content: article?.meta.description ?? "" },
  ];
}

const mdxComponents = {
  a: ContentLink,
  li: ListItemWithAsk,
  p: ParagraphWithAsk,
  pre: MdxPre,
};

export default function LearningArticle({
  params,
  loaderData,
}: Route.ComponentProps) {
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

      <article className="prose-garden pb-10">
        <article.Component components={mdxComponents} />
      </article>

      <div className="border-t pt-8 pb-16">
        <CommentThread
          targetType="article"
          targetId={meta.slug}
          comments={loaderData.comments}
          canModerate={loaderData.canModerate}
        />
      </div>
    </div>
  );
}
