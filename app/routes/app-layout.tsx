import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/app-layout";
import { cloudflareContext } from "~/lib/context";
import { AgentSidebar } from "~/components/gardener/agent-sidebar";
import {
  GardenerProvider,
  type ChatMessage,
} from "~/components/gardener/gardener-provider";
import { AppShell } from "~/components/shell/app-shell";
import { requireUser } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import { clubPath } from "~/lib/club-path";
import { activeThread, parseContext } from "~/lib/threads.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  // Progressive flow: newcomers answer the questionnaire first.
  // Admins bypass so the host is never locked out.
  if (club.membership?.onboardingStage === "invited" && !club.isSuperAdmin) {
    throw redirect(clubPath(club.club.slug, "welcome"));
  }
  const { threadId, messages: history } = await activeThread(env, {
    clubId: club.club.id,
    userId: user.id,
  });
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
      modelId: club.membership?.modelPref ?? user.modelPref,
    },
  };
}

export type AppUser = Awaited<ReturnType<typeof loader>>["user"];

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <GardenerProvider
      // No key here on purpose: the provider must survive navigations, even
      // when the loader revalidates with a new active thread id (the first
      // message of a session creates one). Thread switches ("continue",
      // clear, plant) already update the sidebar client-side; a remount
      // would cut off a streaming reply.
      initialMessages={loaderData.gardener.messages}
      initialModelId={loaderData.gardener.modelId}
    >
      <AppShell aside={<AgentSidebar />}>
        <Outlet />
      </AppShell>
    </GardenerProvider>
  );
}
