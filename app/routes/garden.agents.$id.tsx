import { ArrowLeft, Bot } from "lucide-react";
import { useCallback, useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { callErrorEnvelope, capCallResult } from "@vibegarden/agent-web";

import type { Route } from "./+types/garden.agents.$id";
import { TraceChat } from "~/components/workbench/trace-chat";
import {
  useAgentChat,
  type ToolExecutor,
} from "~/components/workbench/use-agent-chat";
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
import type { AgentDefinition } from "~/lib/agents/contracts";
import { parseAgentDefinition } from "~/lib/agents/contracts";
import {
  getAgentForUser,
  saveAgentVersion,
} from "~/lib/agents/repository.server";
import { buildAgentSystemPrompt } from "~/lib/agents/prompt.server";
import { requireUser } from "~/lib/auth.server";
import { clubPath } from "~/lib/club-path";
import { requireClubContext } from "~/lib/clubs.server";
import { cloudflareContext } from "~/lib/context";
import { getDb } from "~/lib/db.server";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.agent.name} · Agent Workbench` : "Agent Workbench" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const loaded = await getAgentForUser(
    getDb(env),
    { clubId: club.club.id, userId: user.id },
    params.id ?? "",
  );
  if (!loaded) throw new Response("Agent not found.", { status: 404 });

  return {
    ...loaded,
    canEdit: loaded.agent.ownerId === user.id,
    modelPrompt: buildAgentSystemPrompt(
      loaded.definition,
      club.club.name,
      [],
    ),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const form = await request.formData();

  if (form.get("intent") !== "save") {
    return { error: "Unknown action." };
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Give your agent a name." };

  let rawDefinition: unknown;
  try {
    rawDefinition = JSON.parse(String(form.get("definition") ?? ""));
  } catch {
    return { error: "The agent definition is not valid JSON." };
  }
  const parsed = parseAgentDefinition(rawDefinition);
  if (parsed.error) return { error: parsed.error };

  const loaded = await getAgentForUser(
    getDb(env),
    { clubId: club.club.id, userId: user.id },
    params.id ?? "",
  );
  if (!loaded || loaded.agent.ownerId !== user.id) {
    return { error: "Only the agent owner can save changes." };
  }

  await saveAgentVersion(
    getDb(env),
    { clubId: club.club.id, userId: user.id },
    loaded.agent.id,
    {
      name,
      description: String(form.get("description") ?? "").trim(),
      definition: parsed.value,
    },
  );
  return { saved: true };
}

function DefinitionEditor({
  agent,
  definition,
  actionData,
}: {
  agent: { name: string; description: string };
  definition: AgentDefinition;
  actionData: Route.ComponentProps["actionData"];
}) {
  const navigation = useNavigation();
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [systemPrompt, setSystemPrompt] = useState(definition.systemPrompt);
  const saving =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "save";
  const submittedDefinition = JSON.stringify({ ...definition, systemPrompt });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-xl font-normal">Instructions</CardTitle>
        <CardDescription>Give the agent a purpose, voice, and clear boundaries.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" className="space-y-5">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="definition" value={submittedDefinition} />
          <div className="space-y-2">
            <label htmlFor="agent-name" className="text-sm font-medium">Name</label>
            <Input
              id="agent-name"
              name="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="agent-description" className="text-sm font-medium">Description</label>
            <Textarea
              id="agent-description"
              name="description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="system-prompt" className="text-sm font-medium">System prompt</label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {systemPrompt.length.toLocaleString()} / 8,000
              </span>
            </div>
            <Textarea
              id="system-prompt"
              rows={14}
              maxLength={8_000}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="You are a thoughtful museum guide. Explain each artwork in plain language, ask one curious follow-up question, and never invent facts."
              className="min-h-72 resize-y font-mono text-sm leading-relaxed"
            />
          </div>
          {actionData && "error" in actionData && actionData.error && (
            <p role="alert" className="text-sm text-destructive">{actionData.error}</p>
          )}
          {actionData && "saved" in actionData && actionData.saved && (
            <p role="status" className="text-sm text-muted-foreground">Saved as a new version.</p>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save new version"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}

function WorkbenchChat({
  clubSlug,
  agentId,
  versionId,
}: {
  clubSlug: string;
  agentId: string;
  versionId: string;
}) {
  const fetchPage = useCallback<ToolExecutor>(
    async (call) => {
      if (typeof call.args.url !== "string") {
        return {
          envelope: callErrorEnvelope("fetch_page needs a string URL."),
        };
      }

      try {
        const response = await fetch(
          `/clubs/${encodeURIComponent(clubSlug)}/api/fetch-proxy`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: call.args.url }),
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          body?: unknown;
          error?: unknown;
        } | null;
        if (!response.ok) {
          return {
            envelope: callErrorEnvelope(
              typeof payload?.error === "string" && payload.error
                ? payload.error
                : "The page could not be fetched.",
            ),
          };
        }
        if (typeof payload?.body !== "string") {
          return {
            envelope: callErrorEnvelope(
              "The fetch proxy returned an invalid response.",
            ),
          };
        }
        return { raw: payload.body, envelope: capCallResult(payload.body) };
      } catch (error) {
        return {
          envelope: callErrorEnvelope(
            error instanceof Error && error.message
              ? error.message
              : "The page could not be fetched.",
          ),
        };
      }
    },
    [clubSlug],
  );
  const fallbackExecutor = useCallback<ToolExecutor>(
    async () => ({
      envelope: callErrorEnvelope("No executor for this tool yet."),
    }),
    [],
  );
  const { entries, send, busy, reset, rawResults } = useAgentChat({
    clubSlug,
    agentId,
    versionId,
    executors: { fetch_page: fetchPage },
    fallbackExecutor,
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

export default function AgentWorkbench({ loaderData, actionData, params }: Route.ComponentProps) {
  const { agent, version, definition, canEdit, modelPrompt } = loaderData;
  const listPath = clubPath(params.clubSlug, "garden/agents");

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to={listPath}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Agent Workbench
      </Link>
      <div className="mb-8 flex items-start gap-3 border-b pb-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-3xl">{agent.name}</h1>
          <p className="mt-2 text-muted-foreground">
            {agent.description || "A prompt-only agent ready to shape and test."}
          </p>
        </div>
      </div>

      {!canEdit && (
        <p className="mb-6 rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          This agent is shared with the club. You can test the shared version, but only its owner can edit it.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          {canEdit ? (
            <DefinitionEditor
              key={version.id}
              agent={agent}
              definition={definition}
              actionData={actionData}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-xl font-normal">Instructions</CardTitle>
                <CardDescription>Read-only shared version</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <p className="text-sm font-medium">System prompt</p>
                  <pre className="mt-2 min-h-40 whitespace-pre-wrap rounded-lg border bg-muted/20 p-4 font-mono text-sm leading-relaxed">
                    {definition.systemPrompt || "No builder instructions yet."}
                  </pre>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <WorkbenchChat
            key={version.id}
            clubSlug={params.clubSlug}
            agentId={agent.id}
            versionId={version.id}
          />

          <details className="group rounded-xl border bg-card shadow-sm">
            <summary className="cursor-pointer list-none px-6 py-5 font-serif text-lg [&::-webkit-details-marker]:hidden">
              What the model sees
              <span className="ml-2 font-sans text-xs text-muted-foreground group-open:hidden">Show</span>
              <span className="ml-2 hidden font-sans text-xs text-muted-foreground group-open:inline">Hide</span>
            </summary>
            <div className="border-t px-6 py-5">
              <p className="mb-3 text-sm text-muted-foreground">
                The complete system prompt for this saved version, including Vibe Garden's framing.
              </p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-4 font-mono text-xs leading-relaxed">
                {modelPrompt}
              </pre>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
