import {
  ArrowLeft,
  Bot,
  BrainCircuit,
  Copy,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/garden.agents.$id.run";
import { agentMemory } from "~/components/workbench/memory.client";
import { createRunner } from "~/components/workbench/runner.client";
import { TraceChat } from "~/components/workbench/trace-chat";
import { useAgentChat } from "~/components/workbench/use-agent-chat";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import type { AgentDefinition } from "~/lib/agents/contracts";
import { getAgentForUser, remixAgent } from "~/lib/agents/repository.server";
import { agentToolSpecs } from "~/lib/agents/tools.server";
import { toolToYaml } from "~/lib/agents/yaml";
import { requireUser } from "~/lib/auth.server";
import { clubPath } from "~/lib/club-path";
import { requireClubContext } from "~/lib/clubs.server";
import { cloudflareContext } from "~/lib/context";
import { getDb } from "~/lib/db.server";
import {
  createWorkbenchWiring,
  fetchWorkbenchPage,
} from "~/routes/garden.agents.$id";

export function meta({ data }: Route.MetaArgs) {
  return [
    {
      title: data
        ? `${data.agent.name} · Try shared agent`
        : "Try shared agent · Agent Workbench",
    },
  ];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const scope = { clubId: club.club.id, userId: user.id };
  const loaded = await getAgentForUser(getDb(env), scope, params.id ?? "");
  if (!loaded) throw new Response("Agent not found.", { status: 404 });

  const workbenchPath = clubPath(
    club.club.slug,
    `garden/agents/${encodeURIComponent(loaded.agent.id)}`,
  );
  if (loaded.agent.ownerId === user.id) return redirect(workbenchPath);

  const builder = await env.DB.prepare(
    "SELECT name, email FROM users WHERE id = ?",
  )
    .bind(loaded.agent.ownerId)
    .first<{ name: string | null; email: string }>();

  return {
    ...loaded,
    builder: builder?.name || builder?.email || "A club member",
    runnerUrl: new URL("/agent-runner", env.RENDERER_ORIGIN).href,
    userId: user.id,
    offeredToolNames: agentToolSpecs(loaded.definition).map(
      (tool) => tool.name,
    ),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const form = await request.formData();
  if (form.get("intent") !== "remix") {
    return { error: "Unknown action." };
  }

  const remixed = await remixAgent(
    getDb(env),
    { clubId: club.club.id, userId: user.id },
    params.id ?? "",
  );
  if (!remixed) {
    return { error: "This agent is no longer shared with the club." };
  }
  return redirect(
    clubPath(
      club.club.slug,
      `garden/agents/${encodeURIComponent(remixed.id)}`,
    ),
  );
}

function SharedAgentChat({
  clubSlug,
  agentId,
  versionId,
  definition,
  offeredToolNames,
  runnerUrl,
  userId,
}: {
  clubSlug: string;
  agentId: string;
  versionId: string;
  definition: AgentDefinition;
  offeredToolNames: string[];
  runnerUrl: string;
  userId: string;
}) {
  const [memory, setMemory] = useState<ReturnType<typeof agentMemory> | null>(
    null,
  );
  const runnerRef = useRef<ReturnType<typeof createRunner> | null>(null);
  const fetchPage = useCallback(
    (url: string) => fetchWorkbenchPage(clubSlug, url),
    [clubSlug],
  );
  const getRunner = useCallback(() => runnerRef.current, []);

  useEffect(() => {
    setMemory(agentMemory(agentId, userId));
  }, [agentId, userId]);

  const wiring = useMemo(
    () =>
      memory
        ? createWorkbenchWiring({
            definition,
            fetchPage,
            memory,
            getRunner,
          })
        : null,
    [definition, fetchPage, getRunner, memory],
  );

  useEffect(() => {
    if (!wiring) return;
    const runner = createRunner({ runnerUrl, host: wiring.host });
    runnerRef.current = runner;
    return () => {
      runnerRef.current = null;
      runner.dispose();
    };
  }, [runnerUrl, wiring]);

  const { entries, send, busy, reset, rawResults } = useAgentChat({
    clubSlug,
    agentId,
    versionId,
    offeredToolNames,
    executors: wiring?.executors,
    fallbackToolNames: definition.tools.map((tool) => tool.name),
    fallbackExecutor: wiring?.fallbackExecutor,
  });

  return (
    <TraceChat
      entries={entries}
      rawResults={rawResults}
      busy={busy}
      send={send}
      reset={reset}
    />
  );
}

function sharedDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function DefinitionSummary({
  definition,
  builder,
}: {
  definition: AgentDefinition;
  builder: string;
}) {
  const builtinNames = Object.entries(definition.builtins)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20">
        <CardTitle className="font-serif text-xl font-normal">
          How this agent works
        </CardTitle>
        <CardDescription>
          Inspect its instructions and code before you run it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-3 rounded-lg border bg-background px-3 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRound className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Built by</p>
            <p className="truncate text-sm font-medium">{builder}</p>
          </div>
        </div>

        <details className="group rounded-lg border bg-background">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Builder instructions
            <span className="ml-2 text-xs font-normal text-muted-foreground group-open:hidden">
              Show
            </span>
            <span className="ml-2 hidden text-xs font-normal text-muted-foreground group-open:inline">
              Hide
            </span>
          </summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t bg-muted/20 p-4 font-mono text-xs leading-relaxed">
            {definition.systemPrompt || "No builder instructions."}
          </pre>
        </details>

        <section aria-labelledby="shared-agent-tools">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2
              id="shared-agent-tools"
              className="flex items-center gap-2 text-sm font-medium"
            >
              <Wrench className="size-4 text-muted-foreground" />
              Custom tools
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {definition.tools.length}
            </span>
          </div>
          {definition.tools.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
              This agent has no custom tools.
            </p>
          ) : (
            <div className="space-y-2">
              {definition.tools.map((tool) => (
                <details
                  key={tool.name}
                  className="group rounded-lg border bg-background"
                >
                  <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <code className="text-sm font-semibold">{tool.name}</code>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {tool.description}
                    </p>
                    <span className="mt-2 inline-block text-xs text-primary group-open:hidden">
                      Show YAML
                    </span>
                    <span className="mt-2 hidden text-xs text-primary group-open:inline">
                      Hide YAML
                    </span>
                  </summary>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t bg-muted/20 p-4 font-mono text-xs leading-relaxed">
                    {toolToYaml(tool)}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </section>

        {(definition.skills.length > 0 || builtinNames.length > 0) && (
          <section
            className="space-y-3 border-t pt-5"
            aria-labelledby="shared-agent-capabilities"
          >
            <h2
              id="shared-agent-capabilities"
              className="flex items-center gap-2 text-sm font-medium"
            >
              <BrainCircuit className="size-4 text-muted-foreground" />
              Other capabilities
            </h2>
            <div className="flex flex-wrap gap-2">
              {definition.skills.map((skill) => (
                <span
                  key={skill.name}
                  className="rounded-full border bg-background px-2.5 py-1 font-mono text-xs"
                  title={skill.description}
                >
                  {skill.name}
                </span>
              ))}
              {builtinNames.map((name) => (
                <span
                  key={name}
                  className="rounded-full border bg-primary/5 px-2.5 py-1 font-mono text-xs text-primary"
                >
                  {name}
                </span>
              ))}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

export default function RunSharedAgent({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const remixing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "remix";
  const listPath = clubPath(params.clubSlug, "garden/agents");

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to={listPath}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Shared agents
      </Link>

      <div className="mb-7 flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-primary">
              Shared agent
            </p>
            <h1 className="text-3xl">{loaderData.agent.name}</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              {loaderData.agent.description || "No description yet."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Shared version from {sharedDate(loaderData.version.createdAt)}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <Form method="post">
            <Button type="submit" name="intent" value="remix" disabled={remixing}>
              <Copy className="size-4" />
              {remixing ? "Remixing..." : "Remix this agent"}
            </Button>
          </Form>
          {actionData?.error && (
            <p role="alert" className="mt-2 max-w-64 text-sm text-destructive">
              {actionData.error}
            </p>
          )}
        </div>
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 text-sm">
        <BrainCircuit className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          Tools run in an isolated browser sandbox. This test uses your own
          memory and your club's model connection.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <DefinitionSummary
          definition={loaderData.definition}
          builder={loaderData.builder}
        />
        <SharedAgentChat
          key={loaderData.version.id}
          clubSlug={params.clubSlug}
          agentId={loaderData.agent.id}
          versionId={loaderData.version.id}
          definition={loaderData.definition}
          offeredToolNames={loaderData.offeredToolNames}
          runnerUrl={loaderData.runnerUrl}
          userId={loaderData.userId}
        />
      </div>
    </div>
  );
}
