import {
  Form,
  Link,
  redirect,
  useNavigation,
  useParams,
  useSearchParams,
} from "react-router";
import { ArrowLeft, MessageCircle, Sprout, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/garden.projects.$id";
import { cloudflareContext } from "~/lib/context";
import { PageHeader } from "~/components/shell/page-header";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useGardener } from "~/components/gardener/gardener-provider";
import { requireUser } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import { clubPath } from "~/lib/club-path";
import { modules } from "~/lib/modules";
import {
  deleteProject,
  getProject,
  updateProject,
} from "~/lib/projects.server";
import { statusLabel } from "~/lib/project-status";
import { listProjectThreads } from "~/lib/threads.server";
import { cn } from "~/lib/utils";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.project.title ?? "Project"} · Vibe Garden` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const scope = { clubId: club.club.id, userId: user.id };
  const project = await getProject(env, scope, params.id);
  if (!project) throw new Response("Project not found", { status: 404 });
  const conversations = await listProjectThreads(
    env,
    scope,
    project.id,
    project.threadId,
  );
  return { project, conversations };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const scope = { clubId: club.club.id, userId: user.id };
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    await deleteProject(env, scope, params.id);
    return redirect(clubPath(club.club.slug, "garden"));
  }

  if (intent === "save") {
    await updateProject(env, scope, params.id, {
      title: String(form.get("title") ?? ""),
      oneLiner: String(form.get("oneLiner") ?? ""),
      status: String(form.get("status") ?? ""),
      modules: form.getAll("modules").map(String),
    });
    return { saved: true };
  }

  return { saved: false };
}

const statuses = ["seed", "growing", "bloomed"] as const;

export default function ProjectDetail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { project, conversations } = loaderData;
  const { clubSlug } = useParams();
  const navigation = useNavigation();
  const { plantProject, addContext } = useGardener();
  const [searchParams, setSearchParams] = useSearchParams();
  const kickoffStarted = useRef(false);
  const busy = navigation.state === "submitting";
  const [chosenModules, setChosenModules] = useState<string[]>(
    project.moduleList,
  );
  const [status, setStatus] = useState<string>(project.status);

  // Freshly planted (?planted=1): open a linked conversation and let The
  // Gardener react to the idea. The ref guards against double-fires.
  useEffect(() => {
    if (searchParams.get("planted") !== "1" || kickoffStarted.current) return;
    kickoffStarted.current = true;
    setSearchParams({}, { replace: true });
    void (async () => {
      await fetch(clubPath(clubSlug ?? "", "api/thread"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      plantProject({
        title: project.title,
        oneLiner: project.oneLiner,
        modules: project.moduleList,
      });
    })();
  }, [searchParams, setSearchParams, plantProject, project]);

  const toggleModule = (m: string) =>
    setChosenModules((c) =>
      c.includes(m) ? c.filter((x) => x !== m) : [...c, m],
    );

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to={clubPath(clubSlug ?? "", "garden")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Idea Garden
      </Link>

      <PageHeader icon={Sprout} title={project.title} description={project.oneLiner ?? undefined}>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            addContext({
              kind: "project",
              label: project.title,
              projectId: project.id,
              content: [
                `Project: ${project.title}`,
                project.oneLiner ? `Idea: ${project.oneLiner}` : null,
                project.moduleList.length > 0
                  ? `Building blocks: ${project.moduleList.join(", ")}`
                  : null,
                `Stage: ${project.status}`,
              ]
                .filter(Boolean)
                .join("\n"),
            })
          }
        >
          <Sprout className="size-4" />
          Discuss with The Gardener
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-normal">
            Tend to it
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="save" />
            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">
                Name
              </label>
              <Input name="title" defaultValue={project.title} required />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">
                In one sentence
              </label>
              <Textarea
                name="oneLiner"
                rows={2}
                defaultValue={project.oneLiner ?? ""}
                placeholder="What should it do?"
              />
            </div>
            <div>
              <p className="mb-1.5 text-sm text-muted-foreground">Stage</p>
              <div className="flex gap-1.5">
                {statuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    aria-pressed={status === s}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      status === s
                        ? "border-primary bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {statusLabel[s]}
                  </button>
                ))}
              </div>
              <input type="hidden" name="status" value={status} />
            </div>
            <div>
              <p className="mb-1.5 text-sm text-muted-foreground">
                Building blocks
              </p>
              <div className="flex flex-wrap gap-1.5">
                {modules.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleModule(m)}
                    aria-pressed={chosenModules.includes(m)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      chosenModules.includes(m)
                        ? "border-primary bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {chosenModules.map((m) => (
                <input key={m} type="hidden" name="modules" value={m} />
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving..." : "Save"}
              </Button>
              {actionData?.saved && !busy && (
                <span className="text-sm text-muted-foreground">Saved.</span>
              )}
            </div>
          </Form>
        </CardContent>
      </Card>

      {conversations.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-lg">
            <MessageCircle className="size-4 text-primary" />
            Conversations about this project
          </h2>
          <ul className="mt-3 divide-y rounded-lg border">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  to={clubPath(clubSlug ?? "", `garden/conversations/${c.id}`)}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <span className="min-w-0 truncate text-sm">
                    {c.title ?? "Untitled conversation"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.messageCount} messages
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10 border-t pt-6">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" className="gap-1.5 text-destructive hover:text-destructive">
              <Trash2 className="size-4" />
              Remove this project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif font-normal">
                Pull it out by the roots?
              </DialogTitle>
              <DialogDescription>
                This removes "{project.title}" for good. Any linked
                conversation stays in your garden.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Form method="post">
                <input type="hidden" name="intent" value="delete" />
                <Button type="submit" variant="destructive" disabled={busy}>
                  Remove it
                </Button>
              </Form>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
