import { Form, Link, redirect, useNavigation } from "react-router";
import { MessageCircle, Plus, Sprout } from "lucide-react";
import { useState } from "react";
import type { Route } from "./+types/garden";
import { cloudflareContext } from "~/lib/context";
import { EmptyState } from "~/components/empty-state";
import { useGardener } from "~/components/gardener/gardener-provider";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { requireUser } from "~/lib/auth.server";
import { modules } from "~/lib/modules";
import { createProject, listProjects } from "~/lib/projects.server";
import { statusLabel } from "~/lib/project-status";
import { listThreads } from "~/lib/threads.server";
import { cn } from "~/lib/utils";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Idea Garden · Vibe Garden" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const [conversations, projects] = await Promise.all([
    listThreads(env, user.id),
    listProjects(env, user.id),
  ]);
  return { conversations, projects };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const form = await request.formData();
  if (form.get("intent") !== "create") {
    return { error: "Unknown action." };
  }
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Give your idea a name, even a silly one." };
  const project = await createProject(env, user.id, {
    title,
    oneLiner: String(form.get("oneLiner") ?? ""),
    modules: form.getAll("modules").map(String),
  });
  // ?planted=1 makes the project page kick off a Gardener conversation.
  return redirect(`/garden/projects/${project.id}?planted=1`);
}

function conversationDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

const statusVariant = {
  seed: "outline",
  growing: "secondary",
  bloomed: "default",
} as const;

function PlantDialog({
  error,
  size = "default",
}: {
  error?: string;
  size?: "default" | "lg";
}) {
  const navigation = useNavigation();
  const [chosen, setChosen] = useState<string[]>([]);
  const toggle = (m: string) =>
    setChosen((c) => (c.includes(m) ? c.filter((x) => x !== m) : [...c, m]));

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size={size} className="gap-1.5">
          <Plus className="size-4" />
          Plant an idea
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif font-normal">
            Plant an idea
          </DialogTitle>
          <DialogDescription>
            A name and a sentence is plenty. It can change as it grows.
          </DialogDescription>
        </DialogHeader>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="create" />
          <Input name="title" required placeholder="Recipe scanner for grandma's cards" />
          <Textarea
            name="oneLiner"
            rows={2}
            placeholder="What should it do, in one sentence?"
          />
          <div>
            <p className="mb-2 text-sm text-muted-foreground">
              Building blocks (optional):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {modules.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggle(m)}
                  aria-pressed={chosen.includes(m)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    chosen.includes(m)
                      ? "border-primary bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            {chosen.map((m) => (
              <input key={m} type="hidden" name="modules" value={m} />
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={navigation.state === "submitting"}
          >
            Plant it
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Garden({ loaderData, actionData }: Route.ComponentProps) {
  const { setOpen } = useGardener();
  const { conversations, projects } = loaderData;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Idea Garden"
        description="Your projects grow here. Start with a rough idea, or none at all: The Gardener helps you find one."
      >
        {projects.length > 0 && (
          <PlantDialog
            error={
              actionData && "error" in actionData ? actionData.error : undefined
            }
          />
        )}
      </PageHeader>

      {projects.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title="Nothing growing yet"
          description="Every project starts as a small idea. No idea yet? Brainstorm with The Gardener. Already have one? Plant it straight away."
        >
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={() => setOpen(true)}>
              Start brainstorming with The Gardener
            </Button>
            <PlantDialog
              size="lg"
              error={
                actionData && "error" in actionData
                  ? actionData.error
                  : undefined
              }
            />
          </div>
        </EmptyState>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} to={`/garden/projects/${p.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="font-serif text-lg font-normal leading-snug">
                      {p.title}
                    </CardTitle>
                    <Badge variant={statusVariant[p.status]} className="shrink-0">
                      {statusLabel[p.status]}
                    </Badge>
                  </div>
                  {p.oneLiner && (
                    <CardDescription className="leading-relaxed">
                      {p.oneLiner}
                    </CardDescription>
                  )}
                  {p.moduleList.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.moduleList.map((m) => (
                        <Badge key={m} variant="secondary" className="font-normal">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </section>
      )}

      {conversations.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg">
            <MessageCircle className="size-4 text-primary" />
            Conversations with The Gardener
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you talked about, safe and sound. Open one to reread it,
            pick it back up, or plant it as a project.
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
    </div>
  );
}
