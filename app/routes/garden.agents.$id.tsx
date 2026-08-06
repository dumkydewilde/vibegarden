import { ArrowLeft, Bot, Sparkles, Sprout } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  CALL_ERROR_MAX_CHARS,
  callErrorEnvelope,
  capCallResult,
} from "@vibegarden/agent-web";

import type { Route } from "./+types/garden.agents.$id";
import { DefinitionEditor } from "~/components/workbench/definition-editor";
import { useOptionalGardener } from "~/components/gardener/gardener-provider";
import { agentMemory } from "~/components/workbench/memory.client";
import {
  createRunner,
  type HostHandlers,
  type RunnerResult,
} from "~/components/workbench/runner.client";
import { TraceChat } from "~/components/workbench/trace-chat";
import {
  useAgentContextScope,
  useScopedToolProposal,
} from "~/components/workbench/use-scoped-tool-proposal";
import {
  useAgentChat,
  type ToolExecutor,
} from "~/components/workbench/use-agent-chat";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
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
    runnerUrl: new URL("/agent-runner", env.RENDERER_ORIGIN).href,
    userId: user.id,
    modelPrompt: buildAgentSystemPrompt(
      loaded.definition,
      club.club.name,
      [],
    ),
  };
}

export type FetchWorkbenchPageResult = {
  status: number;
  contentType: string;
  body: string;
  totalChars: number;
  truncated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFetchWorkbenchPageResult(
  value: unknown,
): value is FetchWorkbenchPageResult {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [
    "body",
    "contentType",
    "status",
    "totalChars",
    "truncated",
  ];
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index]) ||
    !Number.isInteger(value.status) ||
    (value.status as number) < 100 ||
    (value.status as number) > 599 ||
    typeof value.contentType !== "string" ||
    typeof value.body !== "string" ||
    !Number.isSafeInteger(value.totalChars) ||
    (value.totalChars as number) < value.body.length ||
    typeof value.truncated !== "boolean"
  ) {
    return false;
  }
  return value.truncated
    ? value.totalChars > value.body.length
    : value.totalChars === value.body.length;
}

export async function fetchWorkbenchPage(
  clubSlug: string,
  url: string,
): Promise<FetchWorkbenchPageResult> {
  const response = await fetch(
    `/clubs/${encodeURIComponent(clubSlug)}/api/fetch-proxy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      isRecord(payload) && typeof payload.error === "string" && payload.error
        ? payload.error
        : "The page could not be fetched.",
    );
  }
  if (!isFetchWorkbenchPageResult(payload)) {
    throw new Error("The fetch proxy returned an invalid response.");
  }
  return payload;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const RUNNER_LOG_MAX_LINES = 50;
const RUNNER_LOG_MAX_CHARS = 500;

function boundedRunnerLogs(logs: string[]): string[] {
  return logs
    .slice(0, RUNNER_LOG_MAX_LINES)
    .map((line) => line.slice(0, RUNNER_LOG_MAX_CHARS));
}

function rawRunnerResult(value: string, logs: string[]): string {
  const boundedLogs = boundedRunnerLogs(logs);
  return boundedLogs.length === 0
    ? value
    : `${value}\n\nRunner logs:\n${boundedLogs.join("\n")}`;
}

function rawRunnerError(error: string, logs: string[]): string {
  const boundedError = error.slice(0, CALL_ERROR_MAX_CHARS);
  const boundedLogs = boundedRunnerLogs(logs);
  return boundedLogs.length === 0
    ? `Runner error:\n${boundedError}`
    : `Runner error:\n${boundedError}\n\nRunner logs:\n${boundedLogs.join("\n")}`;
}

type WorkbenchMemory = ReturnType<typeof agentMemory>;
type WorkbenchRunner = {
  run: (
    source: string,
    args: Record<string, unknown>,
  ) => Promise<RunnerResult>;
};

export function createWorkbenchWiring({
  definition,
  fetchPage,
  memory,
  getRunner,
}: {
  definition: AgentDefinition;
  fetchPage: (url: string) => Promise<FetchWorkbenchPageResult>;
  memory: WorkbenchMemory;
  getRunner: () => WorkbenchRunner | null;
}): {
  host: HostHandlers;
  executors: Record<string, ToolExecutor>;
  fallbackExecutor: ToolExecutor;
} {
  const fetchPageExecutor: ToolExecutor = async (call) => {
    if (typeof call.args.url !== "string") {
      return {
        envelope: callErrorEnvelope("fetch_page needs a string URL."),
      };
    }

    try {
      const result = await fetchPage(call.args.url);
      return { raw: result.body, envelope: capCallResult(result.body) };
    } catch (error) {
      return {
        envelope: callErrorEnvelope(
          errorMessage(error, "The page could not be fetched."),
        ),
      };
    }
  };

  const remember: ToolExecutor = async (call) => {
    const { key, value } = call.args;
    if (typeof key !== "string" || typeof value !== "string") {
      return {
        envelope: callErrorEnvelope(
          "remember needs string key and value arguments.",
        ),
      };
    }
    try {
      await memory.set(key, value);
      return { envelope: capCallResult(`Remembered ${key}.`) };
    } catch (error) {
      return {
        envelope: callErrorEnvelope(
          errorMessage(error, "The value could not be remembered."),
        ),
      };
    }
  };

  const recall: ToolExecutor = async () => {
    try {
      const raw = (await memory.list())
        .map(({ key, value }) => `${key}: ${value}`)
        .join("\n");
      return { raw, envelope: capCallResult(raw) };
    } catch (error) {
      return {
        envelope: callErrorEnvelope(
          errorMessage(error, "Memory could not be recalled."),
        ),
      };
    }
  };

  const fallbackExecutor: ToolExecutor = async (call) => {
    const tool = definition.tools.find(({ name }) => name === call.tool);
    if (!tool) {
      return {
        envelope: callErrorEnvelope("No executor for this tool yet."),
      };
    }
    const runner = getRunner();
    if (!runner) {
      return {
        envelope: callErrorEnvelope("The tool runner is not ready yet."),
      };
    }
    const result = await runner.run(tool.source, call.args);
    if (!result.ok) {
      return {
        raw: rawRunnerError(result.error, result.logs),
        envelope: callErrorEnvelope(result.error),
      };
    }
    return {
      raw: rawRunnerResult(result.value, result.logs),
      envelope: capCallResult(result.value),
    };
  };

  return {
    host: {
      fetchPage,
      memoryGet: memory.get,
      memorySet: memory.set,
      memoryList: memory.list,
    },
    executors: { fetch_page: fetchPageExecutor, remember, recall },
    fallbackExecutor,
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

function WorkbenchChat({
  clubSlug,
  agentId,
  versionId,
  definition,
  runnerUrl,
  userId,
}: {
  clubSlug: string;
  agentId: string;
  versionId: string;
  definition: AgentDefinition;
  runnerUrl: string;
  userId: string;
}) {
  const [memory, setMemory] = useState<WorkbenchMemory | null>(null);
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
    () => memory
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
    const runner = createRunner({
      runnerUrl,
      host: wiring.host,
    });
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
    executors: wiring?.executors,
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

export default function AgentWorkbench({ loaderData, actionData, params }: Route.ComponentProps) {
  const {
    agent,
    version,
    definition,
    canEdit,
    modelPrompt,
    runnerUrl,
    userId,
  } = loaderData;
  const gardener = useOptionalGardener();
  const [workingDefinition, setWorkingDefinition] =
    useState<AgentDefinition>(definition);
  const stagedTool = useScopedToolProposal(agent.id, canEdit);
  useAgentContextScope(agent.id, gardener?.removeAgentContext);
  const listPath = clubPath(params.clubSlug, "garden/agents");

  const openSidekick = () => {
    gardener?.addContext({
      kind: "agent-definition",
      agentId: agent.id,
      label: agent.name,
      content: JSON.stringify(workingDefinition),
    });
  };

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
              stagedTool={stagedTool}
              onDefinitionChange={setWorkingDefinition}
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
          {canEdit && gardener && (
            <Card className="overflow-hidden border-primary/20 bg-primary/[0.03]">
              <CardHeader className="border-b border-primary/10">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Sprout className="size-4 text-primary" />
                  </span>
                  <div>
                    <CardTitle className="font-serif text-xl font-normal">
                      Build with The Gardener
                    </CardTitle>
                    <CardDescription className="mt-1 leading-relaxed">
                      Share this draft as context, then ask for a small tool you can inspect before adding.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <Button
                  type="button"
                  onClick={openSidekick}
                >
                  <Sparkles className="size-4" />
                  Ask for a tool
                </Button>
              </CardContent>
            </Card>
          )}

          <WorkbenchChat
            key={version.id}
            clubSlug={params.clubSlug}
            agentId={agent.id}
            versionId={version.id}
            definition={definition}
            runnerUrl={runnerUrl}
            userId={userId}
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
