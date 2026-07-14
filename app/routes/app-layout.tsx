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
import { threadMessages } from "~/lib/threads.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const history = await threadMessages(env, user.id);
  const chatMessages: ChatMessage[] = history.map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? ("gardener" as const) : ("user" as const),
    text: m.content,
  }));
  return {
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      stage: user.stage,
    },
    gardener: {
      messages: chatMessages,
      modelId: user.modelPref,
    },
  };
}

export type AppUser = Awaited<ReturnType<typeof loader>>["user"];

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <GardenerProvider
      initialMessages={loaderData.gardener.messages}
      initialModelId={loaderData.gardener.modelId}
    >
      <AppShell aside={<AgentSidebar />}>
        <Outlet />
      </AppShell>
    </GardenerProvider>
  );
}
