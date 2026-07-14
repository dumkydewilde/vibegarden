import { Form, Link, redirect } from "react-router";
import { ArrowLeft, Send, Sprout } from "lucide-react";
import { useState } from "react";
import type { Route } from "./+types/garden.conversations.$id";
import { cloudflareContext } from "~/lib/context";
import { ChatMessageBubble } from "~/components/gardener/chat-message";
import { useGardener } from "~/components/gardener/gardener-provider";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { requireUser } from "~/lib/auth.server";
import { createProject } from "~/lib/projects.server";
import { getThread, parseContext } from "~/lib/threads.server";

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
    threadId: result.thread.id,
    title: result.thread.title ?? "Untitled conversation",
    messages: result.messages.map((m) => ({
      id: m.id,
      role: m.role === "assistant" ? ("gardener" as const) : ("user" as const),
      text: m.content,
      context: parseContext(m.context),
    })),
  };
}

/** "Plant this as a project": creates a project linked to this thread. */
export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const thread = await getThread(env, user.id, params.id);
  if (!thread) throw new Response("Conversation not found", { status: 404 });
  const project = await createProject(env, user.id, {
    title: thread.thread.title ?? "A budding idea",
    threadId: thread.thread.id,
  });
  return redirect(`/garden/projects/${project.id}`);
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
  const { resumeConversation, busy } = useGardener();
  const [draft, setDraft] = useState("");
  const [resuming, setResuming] = useState(false);

  const continueConversation = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      // Make this thread the active one server-side, then hand the
      // transcript (and the typed question, if any) to the sidebar.
      await fetch("/api/thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: loaderData.threadId }),
      });
      resumeConversation(loaderData.messages, draft);
      setDraft("");
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="mx-auto max-w-[70ch]">
      <div className="mb-10">
        <Link
          to="/garden"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Idea Garden
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl leading-tight md:text-4xl">
            {loaderData.title}
          </h1>
          <Form method="post">
            <Button
              type="submit"
              variant="outline"
              className="gap-1.5"
              title="Turn this conversation into a project in your garden"
            >
              <Sprout className="size-4" />
              Plant as a project
            </Button>
          </Form>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {loaderData.messages.map((m) => (
          <ChatMessageBubble key={m.id} message={m} />
        ))}
      </div>

      <form
        className="sticky bottom-0 mt-4 flex items-center gap-2 border-t bg-background py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void continueConversation();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Pick this conversation back up..."
          aria-label="Continue this conversation"
        />
        <Button
          type="submit"
          disabled={resuming || busy}
          className="shrink-0 gap-1.5"
        >
          <Send className="size-4" />
          Continue
        </Button>
      </form>
      <p className="pb-6 text-xs text-muted-foreground">
        The conversation reopens in The Gardener panel, with everything above
        still in its memory.
      </p>
    </div>
  );
}
