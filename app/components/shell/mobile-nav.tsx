import { Form, NavLink, useParams } from "react-router";
import { LogOut, Menu, Sprout } from "lucide-react";
import { useState } from "react";
import { useAppUser } from "~/hooks/use-app-user";
import { navItems } from "~/lib/nav";
import { FeedbackDialog } from "~/components/feedback/feedback-dialog";
import { ThemeToggle } from "~/components/theme-toggle";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";
import { clubPath } from "~/lib/club-path";
import { ClubSwitcher, type ClubSwitcherProps } from "./club-switcher";

export function MobileNav({ current, clubs }: Pick<ClubSwitcherProps, "current" | "clubs">) {
  const [open, setOpen] = useState(false);
  const user = useAppUser();
  const { clubSlug } = useParams();
  const items = navItems.filter(
    (item) => !item.adminOnly || user?.canManageClub,
  );

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/95 px-3 backdrop-blur md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b p-0 text-left">
            <div className="flex gap-2 px-4 py-3">
              <Sprout className="size-5 text-primary" />
              <div className="min-w-0 flex-1">
                <SheetTitle className="block font-serif text-lg leading-5 font-normal">
                  Vibe Garden
                </SheetTitle>
                <ClubSwitcher current={current} clubs={clubs} onNavigate={() => setOpen(false)} />
              </div>
            </div>
          </SheetHeader>
          <ul className="flex flex-col gap-1 p-2">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={clubPath(clubSlug ?? "", item.to)}
                  end={item.to === ""}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                      isActive
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground",
                    )
                  }
                >
                  <item.icon className="size-4" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          {user && (
            <div className="mt-auto border-t px-2 py-1.5">
              <FeedbackDialog
                className="w-full justify-start gap-1.5 text-muted-foreground"
                onDone={() => setOpen(false)}
              />
            </div>
          )}
          {user && (
            <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
              <span
                className="truncate text-xs text-muted-foreground"
                title={user.email}
              >
                {user.name ?? user.email}
              </span>
              <Form method="post" action="/logout">
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                >
                  <LogOut className="size-3.5" />
                  Sign out
                </Button>
              </Form>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <NavLink to={clubPath(clubSlug ?? "")} className="flex items-center gap-2 font-serif text-lg">
        <Sprout className="size-5 text-primary" />
        Vibe Garden
      </NavLink>

      <ThemeToggle />
    </header>
  );
}
