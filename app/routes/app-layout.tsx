import { Outlet } from "react-router";
import type { Route } from "./+types/app-layout";
import { cloudflareContext } from "~/lib/context";
import { AgentSidebar } from "~/components/gardener/agent-sidebar";
import { GardenerProvider } from "~/components/gardener/gardener-provider";
import { AppShell } from "~/components/shell/app-shell";
import { requireUser } from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUser(context.get(cloudflareContext).env, request);
  return {
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      stage: user.stage,
    },
  };
}

export type AppUser = Awaited<ReturnType<typeof loader>>["user"];

export default function AppLayout() {
  return (
    <GardenerProvider>
      <AppShell aside={<AgentSidebar />}>
        <Outlet />
      </AppShell>
    </GardenerProvider>
  );
}
