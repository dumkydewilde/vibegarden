import { Link } from "react-router";
import { ArrowLeft, MessageCircle } from "lucide-react";
import type { Route } from "./+types/admin.conversations.$id";
import { cloudflareContext } from "~/lib/context";
import { ChatMessageBubble } from "~/components/gardener/chat-message";
import { PageHeader } from "~/components/shell/page-header";
import { requireAdmin } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import { getAdminThread, parseContext } from "~/lib/threads.server";

export function meta({ data }: Route.MetaArgs) {
  return [
    {
      title: `${data?.title ?? "Conversation"} · Admin · Vibe Garden`,
    },
  ];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireAdmin(env, request);
  const club = await requireClubContext(env, request, "wotf");
  const result = await getAdminThread(env, club.club.id, params.id);
  if (!result) throw new Response("Conversation not found", { status: 404 });

  return {
    title: result.thread.title ?? "Untitled conversation",
    participant: {
      name: result.participant.name,
      email: result.participant.email,
    },
    messages: result.messages.map((message) => ({
      id: message.id,
      role: message.role === "assistant" ? ("gardener" as const) : ("user" as const),
      text: message.content,
      context: parseContext(message.context),
    })),
  };
}

export default function AdminConversation({ loaderData }: Route.ComponentProps) {
  const participant = loaderData.participant.name ?? loaderData.participant.email;

  return (
    <div className="mx-auto max-w-[70ch]">
      <Link
        to="/admin"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Admin
      </Link>
      <PageHeader
        icon={MessageCircle}
        title={loaderData.title}
        description={`Read-only conversation with ${participant}.`}
      />
      <div className="flex flex-col gap-6 pb-6">
        {loaderData.messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}
