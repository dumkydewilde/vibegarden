import { Link } from "react-router";
import { Sprout } from "lucide-react";
import { ThemeToggle } from "~/components/theme-toggle";

export function GlobalPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-serif text-lg">
            <Sprout className="size-5 text-primary" />
            Vibe Garden
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-8 md:py-12">{children}</main>
    </div>
  );
}
