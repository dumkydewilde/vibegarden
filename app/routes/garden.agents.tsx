import { Bot, Plus } from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/garden.agents";
import type { Agent } from "~/db/schema";
import { PageHeader } from "~/components/shell/page-header";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { createAgent, listAgents } from "~/lib/agents/repository.server";
import { emptyDefinition } from "~/lib/agents/contracts";
import { requireUser } from "~/lib/auth.server";
import { clubPath } from "~/lib/club-path";
import { requireClubContext } from "~/lib/clubs.server";
import { cloudflareContext } from "~/lib/context";
import { getDb } from "~/lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Agent Workbench · Vibe Garden" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  return listAgents(getDb(env), {
    clubId: club.club.id,
    userId: user.id,
  });
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const form = await request.formData();

  if (form.get("intent") !== "create") {
    return { error: "Unknown action." };
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Give your agent a name." };

  const { agent } = await createAgent(
    getDb(env),
    { clubId: club.club.id, userId: user.id },
    {
      name,
      description: String(form.get("description") ?? "").trim(),
      definition: emptyDefinition(),
    },
  );
  return redirect(
    clubPath(club.club.slug, `garden/agents/${encodeURIComponent(agent.id)}`),
  );
}

function updatedDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function AgentTable({
  agents,
  clubSlug,
  emptyMessage,
}: {
  agents: Agent[];
  clubSlug: string;
  emptyMessage: string;
}) {
  if (agents.length === 0) {
    return <p className="px-5 py-8 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">Name</th>
            <th scope="col" className="px-5 py-3 font-medium">Description</th>
            <th scope="col" className="px-5 py-3 text-right font-medium">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {agents.map((agent) => (
            <tr key={agent.id} className="transition-colors hover:bg-muted/30">
              <td className="px-5 py-4 font-medium">
                <Link
                  to={clubPath(
                    clubSlug,
                    `garden/agents/${encodeURIComponent(agent.id)}`,
                  )}
                  className="underline-offset-4 hover:text-primary hover:underline"
                >
                  {agent.name}
                </Link>
              </td>
              <td className="max-w-md px-5 py-4 text-muted-foreground">
                {agent.description || "No description yet."}
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-right text-muted-foreground">
                {updatedDate(agent.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Agents({ loaderData, actionData, params }: Route.ComponentProps) {
  const navigation = useNavigation();
  const creating =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "create";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        icon={Bot}
        title="Agent Workbench"
        description="Build prompt-driven agents, test their instructions, and learn what the model actually sees."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5">
              <CardTitle className="font-serif text-xl font-normal">Your agents</CardTitle>
              <CardDescription>Private drafts you can edit and test.</CardDescription>
            </CardHeader>
            <AgentTable
              agents={loaderData.mine}
              clubSlug={params.clubSlug}
              emptyMessage="Create your first agent to start experimenting."
            />
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5">
              <CardTitle className="font-serif text-xl font-normal">Shared with the club</CardTitle>
              <CardDescription>Agents other members have made available to try.</CardDescription>
            </CardHeader>
            <AgentTable
              agents={loaderData.shared}
              clubSlug={params.clubSlug}
              emptyMessage="No one has shared an agent yet."
            />
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-serif text-xl font-normal">
              <Plus className="size-4 text-primary" />
              Create an agent
            </CardTitle>
            <CardDescription>Start with a name. You can shape its prompt next.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="create" />
              <div className="space-y-2">
                <label htmlFor="agent-name" className="text-sm font-medium">Name</label>
                <Input id="agent-name" name="name" required placeholder="Museum guide" />
              </div>
              <div className="space-y-2">
                <label htmlFor="agent-description" className="text-sm font-medium">Description</label>
                <Textarea
                  id="agent-description"
                  name="description"
                  rows={3}
                  placeholder="Explains artworks in clear, curious language."
                />
              </div>
              {actionData?.error && (
                <p role="alert" className="text-sm text-destructive">{actionData.error}</p>
              )}
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? "Creating..." : "Create agent"}
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
