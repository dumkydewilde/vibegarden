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
import {
  listActiveClubs,
  listUserClubs,
  requireClubContext,
} from "~/lib/clubs.server";
import { clubPath } from "~/lib/club-path";
import { activeThread, parseContext } from "~/lib/threads.server";
import { models } from "~/lib/models";

export type AppClub = {
  id: string;
  name: string;
  slug: string;
};

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  // This runs only after canonical slug, active status, and access checks
  // succeed. A failed switch therefore never displaces the user's last club.
  await env.DB.prepare("UPDATE users SET last_club_id = ? WHERE id = ?")
    .bind(club.club.id, user.id)
    .run();
  // Progressive flow: newcomers answer the questionnaire first.
  // Admins bypass so the host is never locked out.
  if (club.membership?.onboardingStage === "invited" && !club.isSuperAdmin) {
    throw redirect(clubPath(club.club.slug, "welcome"));
  }
  const memberships = await listUserClubs(env, user.id);
  const activeClubs = club.isSuperAdmin
    ? await listActiveClubs(env)
    : memberships
        .filter((entry) => entry.club.status === "active")
        .map((entry) => entry.club);
  const explicitRoles = new Map(
    memberships.map((entry) => [entry.club.id, entry.membership.role]),
  );
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
    club: {
      id: club.club.id,
      name: club.club.name,
      slug: club.club.slug,
    },
    explicitRole: club.membership?.role ?? null,
    effectiveRole: club.effectiveRole,
    clubs: activeClubs.map((activeClub) => ({
      name: activeClub.name,
      slug: activeClub.slug,
      role: explicitRoles.get(activeClub.id) ?? "admin",
    })),
    allowedModels: models
      .filter((model) => club.club.modelPolicy === "all_models" || model.id.endsWith(":free"))
      .map((model) => model.id),
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
      // Keep state across navigations in one club, but never carry a thread,
      // model preference, or attached dataset into a different club.
      key={loaderData.club.id}
      initialMessages={loaderData.gardener.messages}
      initialModelId={loaderData.gardener.modelId}
    >
      <AppShell
        club={loaderData.club}
        clubs={loaderData.clubs}
        aside={<AgentSidebar />}
      >
        <Outlet />
      </AppShell>
    </GardenerProvider>
  );
}
