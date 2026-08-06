import { startTurn, type AgentHistoryMessage } from "@vibegarden/agent-core";

import type { User } from "~/db/schema";
import { apiAuthorizationError } from "~/lib/api-errors";
import { getAgentForUser } from "~/lib/agents/repository.server";
import { buildAgentSystemPrompt } from "~/lib/agents/prompt.server";
import { parseAgentChatRequest } from "~/lib/agents/chat-request";
import { requireUser } from "~/lib/auth.server";
import { getClubChatCredential } from "~/lib/club-ai.server";
import { requireClubContext, type ClubContext } from "~/lib/clubs.server";
import { cloudflareContext } from "~/lib/context";
import { getDb } from "~/lib/db.server";
import { resolveClubModel } from "~/lib/models";
import type { Route } from "./+types/api.agents.$agentId.chat";

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  let user: User;
  let club: ClubContext;
  try {
    user = await requireUser(env, request);
    club = await requireClubContext(env, request, params.clubSlug ?? "");
  } catch (error) {
    return apiAuthorizationError(error);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parseAgentChatRequest(raw);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.value;

  const db = getDb(env);
  const loaded = await getAgentForUser(
    db,
    { clubId: club.club.id, userId: user.id },
    params.agentId ?? "",
    body.versionId,
  );
  if (!loaded) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }

  const model = resolveClubModel(
    club.club.modelPolicy,
    undefined,
    club.membership?.modelPref,
  );
  let apiKey: string;
  try {
    apiKey = await getClubChatCredential(env, club.club.id);
  } catch {
    return Response.json(
      { error: "The model is not ready for this club yet." },
      { status: 503 },
    );
  }

  const tools = [];
  const history: AgentHistoryMessage[] = body.messages
    .filter((message) => message.role !== "data")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));

  const turn = await startTurn(
    {
      apiKey,
      model: model.id,
      systemPrompt: buildAgentSystemPrompt(
        loaded.definition,
        club.club.name,
        tools,
      ),
      tools,
      maxToolRounds: 3,
      headers: { "X-Title": "Vibe Garden Agent Workbench" },
    },
    history,
  );
  if (!turn.ok) {
    return Response.json(
      { error: "The language model is not reachable right now." },
      { status: 502 },
    );
  }

  const textStream = new ReadableStream<string>({
    async start(controller) {
      for await (const event of turn.events) {
        if (event.type === "text") controller.enqueue(event.delta);
        if (event.type === "error") {
          controller.enqueue("\n\nSomething went wrong on my end. Try again?");
        }
      }
      controller.close();
    },
  }).pipeThrough(new TextEncoderStream());

  return new Response(textStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
