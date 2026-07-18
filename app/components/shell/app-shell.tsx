import { FeedbackDialog } from "~/components/feedback/feedback-dialog";
import { LeftNav } from "./left-nav";
import { MobileNav } from "./mobile-nav";
import type { ClubSwitcherProps } from "./club-switcher";

export function AppShell({
  children,
  aside,
  club,
  clubs,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  club: ClubSwitcherProps["current"];
  clubs: ClubSwitcherProps["clubs"];
}) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <MobileNav current={club} clubs={clubs} />
      <LeftNav current={club} clubs={clubs} />
      <main className="flex min-w-0 flex-1 flex-col px-4 py-6 md:px-10 md:py-10">
        <div className="flex-1">{children}</div>
        <footer className="mt-10 flex items-center justify-center border-t pt-4 text-muted-foreground">
          <FeedbackDialog />
        </footer>
      </main>
      {aside}
    </div>
  );
}
