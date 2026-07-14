import { eq } from "drizzle-orm";
import type { Route } from "./+types/api.chat";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import {
  buildSystemPrompt,
  readSseRound,
  trimHistory,
  type WireContextItem,
  type WireMessage,
} from "~/lib/gardener.server";
import {
  executeTool,
  toolDefinitions,
  toolNoteFor,
} from "~/lib/gardener-tools.server";
import { findModel, defaultModel } from "~/lib/models";
import {
  ensureThread,
  saveMessage,
  tagThreadWithProject,
} from "~/lib/threads.server";
import { users } from "~/db/schema";

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

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);

  if (!env.OPENROUTER_API_KEY) {
    return Response.json(
      { error: "The Gardener has no OPENROUTER_API_KEY configured." },
      { status: 503 },
    );
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "messages is required." }, { status: 400 });
  }
  const lastMessage = body.messages[body.messages.length - 1];
  if (lastMessage.role !== "user" || !lastMessage.content?.trim()) {
    return Response.json(
      { error: "The last message must be from the user." },
      { status: 400 },
    );
  }

  const model = findModel(body.model) ?? defaultModel;
  const contextItems = (body.context ?? []).slice(0, 8);
  const webSearch = body.web === true;

  const db = getDb(env);
  const thread = await ensureThread(db, user.id);
  if (typeof body.projectId === "string") {
    await tagThreadWithProject(env, user.id, thread.id, body.projectId);
  }
  await saveMessage(
    db,
    thread,
    "user",
    lastMessage.content,
    contextItems.length > 0 ? JSON.stringify(contextItems) : undefined,
  );
  if (user.modelPref !== model.id) {
    await db
      .update(users)
      .set({ modelPref: model.id })
      .where(eq(users.id, user.id));
  }

  const upstreamMessages: UpstreamMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(
        contextItems,
        typeof body.page === "string" ? body.page : undefined,
        { tools: model.tools, freshReads: !!env.MOTHERDUCK_TOKEN },
      ),
    },
    ...trimHistory(body.messages),
  ];

  const callUpstream = (withTools: boolean) =>
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Vibe Garden",
      },
      body: JSON.stringify({
        model: model.id,
        stream: true,
        messages: upstreamMessages,
        ...(withTools ? { tools: toolDefinitions(env) } : {}),
        ...(webSearch ? { plugins: [{ id: "web", max_results: 3 }] } : {}),
      }),
    });

  // The first request happens before the Response exists, so upstream
  // config errors still surface as a JSON 502 instead of a broken stream.
  const first = await callUpstream(model.tools);
  if (!first.ok || !first.body) {
    const detail = await first.text().catch(() => "");
    console.error("OpenRouter error", first.status, detail.slice(0, 500));
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
        for (let round = 0; ; round++) {
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
            // Tool activity renders as its own little bubble client-side.
            emit(
              `${full && !full.endsWith("\n\n") ? "\n\n" : ""}${toolNoteFor(call)}\n\n`,
            );
            upstreamMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: await executeTool(call, env),
            });
          }

          // On the last allowed round, withhold tools to force a text answer.
          response = await callUpstream(round + 1 < MAX_TOOL_ROUNDS);
          if (!response.ok || !response.body) {
            const detail = await response.text().catch(() => "");
            console.error(
              "OpenRouter error mid-conversation",
              response.status,
              detail.slice(0, 500),
            );
            emit("\n\nI lost the connection to the model midway. Ask again?");
            break;
          }
        }
      } catch (e) {
        console.error("gardener stream failed", e);
        if (!full) emit("Something went wrong on my end. Try again?");
      }

      try {
        if (full) await saveMessage(db, thread, "assistant", full);
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
