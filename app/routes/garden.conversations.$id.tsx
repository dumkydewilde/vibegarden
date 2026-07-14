import { Form, Link, redirect } from "react-router";
import { ArrowLeft, MessageCircle } from "lucide-react";
import type { Route } from "./+types/garden.conversations.$id";
import { cloudflareContext } from "~/lib/context";
import { ChatMessageBubble } from "~/components/gardener/chat-message";
import { Button } from "~/components/ui/button";
import { requireUser } from "~/lib/auth.server";
import { getThread, touchThread } from "~/lib/threads.server";

export function meta({ data }: Route.MetaArgs) {
  return [
    {
      title: `${data?.title ?? "Conversation"} · Vibe Garden`,
    },
  ];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const result = await getThread(env, user.id, params.id);
  if (!result) throw new Response("Conversation not found", { status: 404 });
  return {
    title: result.thread.title ?? "Untitled conversation",
    messages: result.messages.map((m) => ({
      id: m.id,
      role: m.role === "assistant" ? ("gardener" as const) : ("user" as const),
      text: m.content,
    })),
  };
}

/** "Continue" makes this thread the active one in the sidebar. */
export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  await touchThread(env, user.id, params.id);
  return redirect("/garden");
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/garden"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Idea Garden
          </Link>
          <h1 className="mt-2 text-2xl">{loaderData.title}</h1>
        </div>
        <Form method="post">
          <Button type="submit" className="gap-1.5">
            <MessageCircle className="size-4" />
            Continue this conversation
          </Button>
        </Form>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        {loaderData.messages.map((m) => (
          <ChatMessageBubble key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}
