import { Link } from "react-router";
import { ArrowLeft, Blocks } from "lucide-react";
import type { Route } from "./+types/garden.modules.$slug";
import { useGardener } from "~/components/gardener/gardener-provider";
import { ContentLink } from "~/components/content-link";
import { MdxPre } from "~/components/mermaid-block";
import {
  ListItemWithAsk,
  ParagraphWithAsk,
} from "~/components/learning/paragraph-with-ask";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { getModule, getModuleRaw } from "~/lib/modules";

export function loader({ params }: Route.LoaderArgs) {
  if (!getModule(params.slug)) {
    throw new Response("Building block not found", { status: 404 });
  }
  return null;
}

export function meta({ params }: Route.MetaArgs) {
  const module = getModule(params.slug);
  return [
    { title: `${module?.meta.title ?? "Building block"} · Vibe Garden` },
    { name: "description", content: module?.meta.description ?? "" },
  ];
}

const mdxComponents = {
  a: ContentLink,
  li: ListItemWithAsk,
  p: ParagraphWithAsk,
  pre: MdxPre,
};

export default function ModulePage({ params }: Route.ComponentProps) {
  const module = getModule(params.slug);
  const { addContext } = useGardener();
  if (!module) return null;

  const { meta } = module;

  const addModuleToContext = () => {
    const raw = getModuleRaw(meta.slug);
    if (raw) {
      addContext({ kind: "module", label: meta.title, content: raw });
    }
  };

  return (
    <div className="article-page">
      <div className="mb-8">
        <Link
          to="/garden"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Idea Garden
        </Link>
        <h1 className="mt-4 text-3xl leading-tight md:text-4xl">
          {meta.title}
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">{meta.description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Building block</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={addModuleToContext}
            className="ml-auto gap-1.5 text-muted-foreground"
          >
            <Blocks className="size-3.5" />
            Discuss with The Gardener
          </Button>
        </div>
      </div>

      <article className="prose-garden pb-16">
        <module.Component components={mdxComponents} />
      </article>
    </div>
  );
}
