import { startTurn } from "@vibegarden/agent-core";
import { markerForEvent } from "@vibegarden/agent-web";

import type { User } from "~/db/schema";
import { apiAuthorizationError } from "~/lib/api-errors";
import { getAgentForUser } from "~/lib/agents/repository.server";
import { buildAgentSystemPrompt } from "~/lib/agents/prompt.server";
import {
  continuationMatchesOfferedTool,
  historyForModel,
  parseAgentChatRequest,
} from "~/lib/agents/chat-request";
import { requireUser } from "~/lib/auth.server";
import { agentToolSpecs } from "~/lib/agents/tools.server";
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
  );
  if (!loaded) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }
  if (loaded.version.id !== body.versionId) {
    return Response.json(
      { error: "This agent version changed. Reload before continuing." },
      { status: 409 },
    );
  }

  const tools = agentToolSpecs(loaded.definition);
  if (
    body.continuation &&
    !continuationMatchesOfferedTool(
      body.messages,
      new Set(tools.map((tool) => tool.name)),
    )
  ) {
    return Response.json(
      { error: "The continuation does not match an offered tool call." },
      { status: 400 },
    );
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

  const history = historyForModel(body.messages);

  const turnConfig = {
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
  };

  let turn: Awaited<ReturnType<typeof startTurn>>;
  try {
    turn = await startTurn(turnConfig, history);
  } catch {
    return Response.json(
      { error: "The language model is not reachable right now." },
      { status: 502 },
    );
  }
  if (!turn.ok) {
    return Response.json(
      { error: "The language model is not reachable right now." },
      { status: 502 },
    );
  }

  const textStream = new ReadableStream<string>({
    async start(controller) {
      let full = "";
      const emit = (delta: string) => {
        full += delta;
        controller.enqueue(delta);
      };
      const emitMarker = (marker: string, trailingBreak: boolean) =>
        emit(
          `${full && !full.endsWith("\n\n") ? "\n\n" : ""}${marker}${trailingBreak ? "\n\n" : ""}`,
        );

      for await (const event of turn.events) {
        switch (event.type) {
          case "text":
            emit(event.delta);
            break;
          case "note":
          case "diagram":
          case "articles": {
            const marker = markerForEvent(event);
            if (marker) emitMarker(marker, true);
            break;
          }
          case "delegated-call": {
            const marker = markerForEvent(event);
            if (marker) emitMarker(marker, false);
            break;
          }
          case "error":
            emit("\n\nSomething went wrong on my end. Try again?");
            break;
          case "done":
            break;
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
