import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/api.chat";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import type { ClubContext } from "~/lib/clubs.server";
import type { User } from "~/db/schema";
import { apiAuthorizationError } from "~/lib/api-errors";
import { getDb } from "~/lib/db.server";
import {
  buildSystemPrompt,
  readSseRound,
  trimHistory,
  type WireContextItem,
  type WireDataset,
  type WireMessage,
} from "~/lib/gardener.server";
import {
  attachMarkerFor,
  executeTool,
  queryMarkerFor,
  toolDefinitions,
  toolNoteFor,
} from "~/lib/gardener-tools.server";
import {
  MAX_DATASETS,
  parseAttachEnvelope,
  parseEnvelope,
} from "~/lib/query-tool";
import { attachResultNote, queryResultNote } from "~/lib/tool-notes";
import { resolveClubModel } from "~/lib/models";
import {
  clubCredentialNeedsProvisioning,
  getClubChatCredential,
} from "~/lib/club-ai.server";
import {
  appendToLastAssistantMessage,
  ensureThread,
  saveMessage,
  tagThreadWithProject,
} from "~/lib/threads.server";
import { clubMemberships } from "~/db/schema";

type ChatRequest = {
  messages: WireMessage[];
  model?: string;
  context?: WireContextItem[];
  /** Pathname the user is currently viewing, e.g. /learning/what-is-an-llm */
  page?: string;
  /** When project context is attached, ties this conversation to it. */
  projectId?: string;
  /** Let the model search the web via the OpenRouter web plugin. */
  web?: boolean;
  /** Datasets registered in the person's browser (DuckDB-WASM views). */
  datasets?: WireDataset[];
  /**
   * True when this request carries query results back for narration; the
   * last message must then be a `data` message with the result envelope.
   */
  continuation?: boolean;
};

/** Messages as sent upstream; assistant turns may carry tool calls. */
type UpstreamMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** Tool-execution rounds per answer; after the last, tools are withheld. */
const MAX_TOOL_ROUNDS = 3;

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
  const scope = { clubId: club.club.id, userId: user.id };

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "messages is required." }, { status: 400 });
  }
  const continuation = body.continuation === true;
  const lastMessage = body.messages[body.messages.length - 1];
  // Re-cap the envelope server-side; the client is not trusted with sizes.
  // An attach error envelope also parses as a query error envelope, so the
  // attach parse (discriminated by its `kind` field) must run first.
  const attachEnvelope = continuation
    ? parseAttachEnvelope(lastMessage.content)
    : null;
  const envelope =
    continuation && !attachEnvelope ? parseEnvelope(lastMessage.content) : null;
  if (continuation) {
    if (lastMessage.role !== "data" || (!envelope && !attachEnvelope)) {
      return Response.json(
        { error: "A continuation needs a valid result envelope." },
        { status: 400 },
      );
    }
  } else if (lastMessage.role !== "user" || !lastMessage.content?.trim()) {
    return Response.json(
      { error: "The last message must be from the user." },
      { status: 400 },
    );
  }

  const model = resolveClubModel(
    club.club.modelPolicy,
    body.model,
    club.membership?.modelPref,
  );
  // An explicit model outside the club policy is not a stale preference: it
  // is an untrusted request and must never reach a decrypted provider key.
  if (typeof body.model === "string" && model.id !== body.model) {
    return Response.json({ error: "That model is not available for this club." }, { status: 400 });
  }
  let apiKey: string;
  try {
    apiKey = await getClubChatCredential(env, club.club.id);
  } catch {
    // The legacy shared key is a deliberately narrow migration bridge. Do
    // not widen it: every club other than WOTF remains fail-closed.
    if (
      club.club.id === "club_wotf" &&
      env.ALLOW_WOTF_LEGACY_KEY === "true" &&
      env.OPENROUTER_API_KEY &&
      await clubCredentialNeedsProvisioning(env, club.club.id).catch(() => false)
    ) {
      apiKey = env.OPENROUTER_API_KEY;
    } else {
      return Response.json(
        { error: "The Gardener is not ready for this club yet." },
        { status: 503 },
      );
    }
  }
  const contextItems = (body.context ?? []).slice(0, 8);
  const webSearch = body.web === true;
  const datasets = (body.datasets ?? [])
    .filter(
      (d) =>
        typeof d?.name === "string" &&
        d.name.trim() &&
        typeof d?.summary === "string",
    )
    .slice(0, MAX_DATASETS);

  const db = getDb(env);
  const thread = await ensureThread(db, scope);
  if (typeof body.projectId === "string") {
    await tagThreadWithProject(env, scope, thread.id, body.projectId);
  }
  // The envelope is not a person's message: it is persisted as a marker on
  // the assistant answer instead (below), keeping one row per visual bubble.
  if (!continuation) {
    await saveMessage(
      db,
      scope,
      thread,
      "user",
      lastMessage.content,
      contextItems.length > 0 ? JSON.stringify(contextItems) : undefined,
    );
  }
  if (club.membership?.modelPref !== model.id) {
    await db
      .update(clubMemberships)
      .set({ modelPref: model.id })
      .where(and(eq(clubMemberships.clubId, club.club.id), eq(clubMemberships.userId, user.id)));
  }

  // After a successful query the model should only narrate, so its
  // continuation turn gets no tools at all (otherwise it wanders into
  // reading unrelated articles or re-fetching). An error continuation keeps
  // tools so it can repair the SQL with query_data. Attach continuations
  // also keep tools: after a successful attach the model should be able to
  // run a first query against the new dataset.
  const narrateOnly = continuation && envelope?.status === "ok";
  const toolsAllowed = model.tools && !narrateOnly;
  const offerQueryData = datasets.length > 0 && !narrateOnly;

  // The model sees the re-capped envelope, not the client's raw payload.
  const recappedEnvelope = envelope ?? attachEnvelope;
  const historyMessages = recappedEnvelope
    ? [
        ...body.messages.slice(0, -1),
        { role: "data" as const, content: JSON.stringify(recappedEnvelope) },
      ]
    : body.messages;

  const upstreamMessages: UpstreamMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(
        contextItems,
        typeof body.page === "string" ? body.page : undefined,
        {
          tools: model.tools,
          freshReads: !!env.MOTHERDUCK_TOKEN,
          datasets,
        },
      ),
    },
    ...trimHistory(historyMessages),
  ];

  const callUpstream = (withTools: boolean) =>
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Vibe Garden",
      },
      body: JSON.stringify({
        model: model.id,
        stream: true,
        messages: upstreamMessages,
        ...(withTools
          ? { tools: toolDefinitions(env, { queryData: offerQueryData }) }
          : {}),
        ...(webSearch ? { plugins: [{ id: "web", max_results: 3 }] } : {}),
      }),
    });

  // The first request happens before the Response exists, so upstream
  // config errors still surface as a JSON 502 instead of a broken stream.
  const first = await callUpstream(toolsAllowed);
  if (!first.ok || !first.body) {
    console.error("OpenRouter request failed", first.status, "upstream_rejected");
    return Response.json(
      { error: "The language model is not reachable right now. Try again, or pick another model." },
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

      try {
        let response = first;
        outer: for (let round = 0; ; round++) {
          const result = await readSseRound(response.body!, emit);
          if (result.toolCalls.length === 0) break;

          upstreamMessages.push({
            role: "assistant",
            content: result.text || null,
            tool_calls: result.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          });
          for (const call of result.toolCalls) {
            // A valid query_data or attach_data ends this turn: the SQL or
            // URL travels to the browser as a marker, and the browser sends
            // the result back in a continuation request. Invalid calls fall
            // through to executeTool so the model hears what was wrong.
            const browserMarker = queryMarkerFor(call) ?? attachMarkerFor(call);
            if (browserMarker) {
              emit(
                `${full && !full.endsWith("\n\n") ? "\n\n" : ""}${browserMarker}`,
              );
              break outer;
            }
            const note = toolNoteFor(call);
            if (note) {
              emit(
                `${full && !full.endsWith("\n\n") ? "\n\n" : ""}${note}\n\n`,
              );
            }
            upstreamMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: await executeTool(call, env),
            });
          }

          // On the last allowed round, withhold tools to force a text answer.
          response = await callUpstream(toolsAllowed && round + 1 < MAX_TOOL_ROUNDS);
          if (!response.ok || !response.body) {
            console.error("OpenRouter stream request failed", response.status, "upstream_rejected");
            emit("\n\nI lost the connection to the model midway. Ask again?");
            break;
          }
        }
      } catch (e) {
        console.error("gardener stream failed", e);
        if (!full) emit("Something went wrong on my end. Try again?");
      }

      try {
        if (envelope || attachEnvelope) {
          // Same visual answer: result marker plus narration are appended
          // onto the assistant row that ended with the query/attach marker.
          const resultNote = envelope
            ? queryResultNote(envelope)
            : attachResultNote(attachEnvelope!);
          await appendToLastAssistantMessage(
            db,
            scope,
            thread,
            `\n\n${resultNote}${full ? `\n\n${full}` : ""}`,
          );
        } else if (full) {
          await saveMessage(db, scope, thread, "assistant", full);
        }
      } catch (e) {
        console.error("failed to persist assistant message", e);
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
