import { Outlet } from "react-router";
import { AgentSidebar } from "~/components/gardener/agent-sidebar";
import { GardenerProvider } from "~/components/gardener/gardener-provider";
import { AppShell } from "~/components/shell/app-shell";

export default function AppLayout() {
  return (
    <GardenerProvider>
      <AppShell aside={<AgentSidebar />}>
        <Outlet />
      </AppShell>
    </GardenerProvider>
  );
}
