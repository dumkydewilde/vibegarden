import { Outlet } from "react-router";
import type { Route } from "./+types/app-layout";
import { cloudflareContext } from "~/lib/context";
import { AgentSidebar } from "~/components/gardener/agent-sidebar";
import {
  GardenerProvider,
  type ChatMessage,
} from "~/components/gardener/gardener-provider";
import { AppShell } from "~/components/shell/app-shell";
import { requireUser } from "~/lib/auth.server";
import { activeThread, parseContext } from "~/lib/threads.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const { threadId, messages: history } = await activeThread(env, user.id);
  const chatMessages: ChatMessage[] = history.map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? ("gardener" as const) : ("user" as const),
    text: m.content,
    context: parseContext(m.context),
  }));
  return {
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      stage: user.stage,
    },
    gardener: {
      threadId,
      messages: chatMessages,
      modelId: user.modelPref,
    },
  };
}

export type AppUser = Awaited<ReturnType<typeof loader>>["user"];

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <GardenerProvider
      // Remount when the active thread changes (e.g. after "continue" on an
      // old conversation) so the sidebar picks up the right history.
      key={loaderData.gardener.threadId ?? "fresh"}
      initialMessages={loaderData.gardener.messages}
      initialModelId={loaderData.gardener.modelId}
    >
      <AppShell aside={<AgentSidebar />}>
        <Outlet />
      </AppShell>
    </GardenerProvider>
  );
}
