import { Moon, Sun } from "lucide-react";
import { Button } from "~/components/ui/button";

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  document.cookie = `vg-theme=${dark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeToggle() {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() =>
        applyTheme(!document.documentElement.classList.contains("dark"))
      }
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="size-4 hidden dark:block" />
    </Button>
  );
}
