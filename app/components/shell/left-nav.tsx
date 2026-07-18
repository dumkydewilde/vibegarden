import { Form, Link, useLocation, useParams } from "react-router";
import { LogOut, PanelLeftClose, PanelLeftOpen, Sprout } from "lucide-react";
import { useState } from "react";
import { useAppUser } from "~/hooks/use-app-user";
import { navItems } from "~/lib/nav";
import { FeedbackDialog } from "~/components/feedback/feedback-dialog";
import { ThemeToggle } from "~/components/theme-toggle";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { clubPath } from "~/lib/club-path";

export function LeftNav() {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const { clubSlug } = useParams();
  const user = useAppUser();
  const items = navItems.filter(
    (item) => !item.adminOnly || user?.role === "admin",
  );

  return (
    <nav
      aria-label="Main"
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex",
        collapsed ? "w-14" : "w-52",
      )}
    >
      <Link
        to={clubPath(clubSlug ?? "")}
        className="flex h-14 items-center gap-2 border-b px-4 font-serif text-lg"
      >
        <Sprout className="size-5 shrink-0 text-primary" />
        {!collapsed && <span>Vibe Garden</span>}
      </Link>

      <TooltipProvider>
        <ul className="flex flex-1 flex-col gap-1 p-2">
          {items.map((item) => {
            const to = clubPath(clubSlug ?? "", item.to);
            const isActive =
              item.to === "/"
                ? pathname === to
                : pathname.startsWith(to);
            return (
              <li key={item.to}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to={to}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  )}
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </TooltipProvider>

      {user && !collapsed && (
        <div className="border-t px-2 py-1.5">
          <FeedbackDialog className="w-full justify-start gap-1.5 text-muted-foreground" />
        </div>
      )}
      {user && !collapsed && (
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
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
              size="icon"
              className="size-7"
              aria-label="Sign out"
            >
              <LogOut className="size-3.5" />
            </Button>
          </Form>
        </div>
      )}
      <div
        className={cn(
          "flex items-center gap-1 border-t p-2",
          collapsed ? "flex-col" : "justify-between",
        )}
      >
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
      </div>
    </nav>
  );
}
