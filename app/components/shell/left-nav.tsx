import { Link, useLocation } from "react-router";
import { PanelLeftClose, PanelLeftOpen, Sprout } from "lucide-react";
import { useState } from "react";
import { navItems } from "~/lib/nav";
import { ThemeToggle } from "~/components/theme-toggle";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export function LeftNav() {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Main"
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex",
        collapsed ? "w-14" : "w-52",
      )}
    >
      <Link
        to="/"
        className="flex h-14 items-center gap-2 border-b px-4 font-serif text-lg"
      >
        <Sprout className="size-5 shrink-0 text-primary" />
        {!collapsed && <span>Vibe Garden</span>}
      </Link>

      <TooltipProvider>
        <ul className="flex flex-1 flex-col gap-1 p-2">
          {navItems.map((item) => {
            const isActive =
              item.to === "/"
                ? pathname === "/"
                : pathname.startsWith(item.to);
            return (
              <li key={item.to}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.to}
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
