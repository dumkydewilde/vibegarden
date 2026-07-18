import { Blocks, BookOpen, ExternalLink } from "lucide-react";
import { Link, useParams } from "react-router";
import { getArticle } from "~/lib/content";
import { getModule } from "~/lib/modules";
import { clubPath } from "~/lib/club-path";

/** The small clickable card for an article or building block. */
export function ContentCard({
  to,
  icon: Icon,
  title,
}: {
  to: string;
  icon: typeof BookOpen;
  title: string;
}) {
  return (
    <Link
      to={to}
      data-card
      className="my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 align-middle text-xs font-medium not-italic text-foreground no-underline shadow-xs transition-colors hover:border-primary/50"
    >
      <Icon className="size-3.5 shrink-0 text-primary" />
      <span className="truncate">{title}</span>
    </Link>
  );
}

/**
 * Shared anchor renderer for chat replies and article MDX: learning
 * articles and building blocks become little cards so they stand apart
 * from web URLs, other internal links go through the router, and external
 * links open in a new tab with an outlink mark.
 */
export function ContentLink({
  href,
  children,
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { clubSlug } = useParams();
  const path = (suffix: string) => clubPath(clubSlug ?? "", suffix);
  const articleSlug = href?.match(/^\/learning\/([\w-]+)$/)?.[1];
  const article = articleSlug ? getArticle(articleSlug) : undefined;
  if (article) {
    return <ContentCard to={path(`learning/${articleSlug}`)} icon={BookOpen} title={article.meta.title} />;
  }
  const moduleSlug = href?.match(/^\/garden\/modules\/([\w-]+)$/)?.[1];
  const module = moduleSlug ? getModule(moduleSlug) : undefined;
  if (module) {
    return <ContentCard to={path(`garden/modules/${moduleSlug}`)} icon={Blocks} title={module.meta.title} />;
  }
  if (href?.startsWith("/")) {
    return (
      <Link to={path(href)} className="text-primary underline underline-offset-2">
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
      <ExternalLink
        aria-hidden
        className="mb-0.5 ml-0.5 inline size-3 align-middle opacity-70"
      />
    </a>
  );
}
