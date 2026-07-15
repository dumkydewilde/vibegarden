import { FeedbackDialog } from "~/components/feedback/feedback-dialog";
import { LeftNav } from "./left-nav";
import { MobileNav } from "./mobile-nav";

export function AppShell({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <MobileNav />
      <LeftNav />
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
