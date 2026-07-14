import { eq } from "drizzle-orm";
import type { Route } from "./+types/api.chat";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import {
  buildSystemPrompt,
  sseToTextStream,
  trimHistory,
  type WireContextItem,
  type WireMessage,
} from "~/lib/gardener.server";
import { findModel, defaultModel } from "~/lib/models";
import { ensureThread, saveMessage } from "~/lib/threads.server";
import { users } from "~/db/schema";

type ChatRequest = {
  messages: WireMessage[];
  model?: string;
  context?: WireContextItem[];
  /** Pathname the user is currently viewing, e.g. /learning/what-is-an-llm */
  page?: string;
};

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

  const db = getDb(env);
  const thread = await ensureThread(db, user.id);
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

  const upstream = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Vibe Garden",
      },
      body: JSON.stringify({
        model: model.id,
        stream: true,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(
              contextItems,
              typeof body.page === "string" ? body.page : undefined,
            ),
          },
          ...trimHistory(body.messages),
        ],
      }),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("OpenRouter error", upstream.status, detail.slice(0, 500));
    return Response.json(
      { error: "The language model is not reachable right now. Try again, or pick another model." },
      { status: 502 },
    );
  }

  const textStream = upstream.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      sseToTextStream(async (fullText) => {
        if (fullText) await saveMessage(db, thread, "assistant", fullText);
      }),
    )
    .pipeThrough(new TextEncoderStream());

  return new Response(textStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
