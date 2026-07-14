import { NavLink } from "react-router";
import { PanelLeftClose, PanelLeftOpen, Sprout } from "lucide-react";
import { useState } from "react";
import { navItems } from "~/lib/nav";
import { ThemeToggle } from "~/components/theme-toggle";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export function LeftNav() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav
      aria-label="Main"
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex",
        collapsed ? "w-14" : "w-52",
      )}
    >
      <NavLink
        to="/"
        className="flex h-14 items-center gap-2 border-b px-4 font-serif text-lg"
      >
        <Sprout className="size-5 shrink-0 text-primary" />
        {!collapsed && <span>Vibe Garden</span>}
      </NavLink>

      <ul className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map((item) => (
          <li key={item.to}>
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">{item.label}</TooltipContent>
              )}
            </Tooltip>
          </li>
        ))}
      </ul>

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
