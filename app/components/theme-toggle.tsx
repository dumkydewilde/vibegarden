import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const fetcher = useFetcher();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => {
        const theme = resolvedTheme === "dark" ? "light" : "dark";
        setTheme(theme);
        fetcher.submit(
          { intent: "theme", theme },
          { method: "post", action: "/settings" },
        );
      }}
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="size-4 hidden dark:block" />
    </Button>
  );
}
