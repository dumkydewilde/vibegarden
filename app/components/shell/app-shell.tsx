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
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
        {children}
      </main>
      {aside}
    </div>
  );
}
