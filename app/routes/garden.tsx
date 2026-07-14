import { Link } from "react-router";
import { MessageCircle, Sprout } from "lucide-react";
import type { Route } from "./+types/garden";
import { cloudflareContext } from "~/lib/context";
import { EmptyState } from "~/components/empty-state";
import { useGardener } from "~/components/gardener/gardener-provider";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { requireUser } from "~/lib/auth.server";
import { listThreads } from "~/lib/threads.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Idea Garden · Vibe Garden" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const conversations = await listThreads(env, user.id);
  return { conversations };
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

function conversationDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function Garden({ loaderData }: Route.ComponentProps) {
  const { setOpen } = useGardener();
  const { conversations } = loaderData;

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

      {conversations.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg">
            <MessageCircle className="size-4 text-primary" />
            Conversations with The Gardener
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you talked about, safe and sound. Open one to reread it
            or pick it back up.
          </p>
          <ul className="mt-4 divide-y rounded-lg border">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/garden/conversations/${c.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <span className="min-w-0 truncate text-sm">
                    {c.title ?? "Untitled conversation"}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    {c.messageCount} messages
                    <span>{conversationDate(c.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
