import { NavLink } from "react-router";
import { Menu, Sprout } from "lucide-react";
import { useState } from "react";
import { navItems } from "~/lib/nav";
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

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/95 px-3 backdrop-blur md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2 font-serif text-lg font-normal">
              <Sprout className="size-5 text-primary" />
              Vibe Garden
            </SheetTitle>
          </SheetHeader>
          <ul className="flex flex-col gap-1 p-2">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
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
        </SheetContent>
      </Sheet>

      <NavLink to="/" className="flex items-center gap-2 font-serif text-lg">
        <Sprout className="size-5 text-primary" />
        Vibe Garden
      </NavLink>

      <ThemeToggle />
    </header>
  );
}
