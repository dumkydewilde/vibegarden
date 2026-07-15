import { Link } from "react-router";
import { TreeDeciduous } from "lucide-react";
import type { Route } from "./+types/learning";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { getArticlesByCategory } from "~/lib/content";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Learning · Vibe Garden" }];
}

export default function Learning() {
  const groups = getArticlesByCategory();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={TreeDeciduous}
        title="Learning"
        description="Short reads, no homework. Read whatever looks useful for what you want to make, in any order."
      />

      {groups.map((group) => (
        <section key={group.category} className="mb-10">
          <h2 className="text-lg text-muted-foreground">{group.category}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {group.articles.map((article) => (
              <Link
                key={article.slug}
                to={`/learning/${article.slug}`}
                className="group"
              >
                <Card className="h-full transition-colors group-hover:border-primary/40">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="font-serif text-lg font-normal leading-snug">
                        {article.title}
                      </CardTitle>
                      <Badge
                        variant={
                          article.level === "starter" ? "secondary" : "outline"
                        }
                        className="shrink-0"
                      >
                        {article.level}
                      </Badge>
                    </div>
                    <CardDescription className="leading-relaxed">
                      {article.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
