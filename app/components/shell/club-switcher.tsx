import { Check, ChevronDown, Plus, Settings } from "lucide-react";
import { Link } from "react-router";
import type { ClubRole } from "~/db/schema";
import { clubPath } from "~/lib/club-path";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export type ClubSwitcherProps = {
  current: { name: string; slug: string };
  clubs: { name: string; slug: string; role: ClubRole }[];
  compact?: boolean;
  onNavigate?: () => void;
};

export function ClubSwitcher({
  current,
  clubs,
  compact = false,
  onNavigate,
}: ClubSwitcherProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={
            compact
              ? "w-full justify-between"
              : "mt-0.5 h-7 w-full justify-between px-0 font-normal has-[>svg]:px-0 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          }
          aria-label={`Switch club, current club ${current.name}`}
        >
          <span className="min-w-0 truncate">{current.name}</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Current club and memberships</DropdownMenuLabel>
        {clubs.map((club) => {
          const isCurrent = club.slug === current.slug;
          return (
            <DropdownMenuItem key={club.slug} asChild data-current={isCurrent || undefined}>
              <Link to={clubPath(club.slug)} onClick={onNavigate}>
                <span className="min-w-0 flex-1 truncate">{club.name}</span>
                <span className="text-xs text-muted-foreground">{club.role}</span>
                {isCurrent && <Check className="size-4" aria-label="Current club" />}
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings?create=1" onClick={onNavigate}>
            <Plus className="size-4" />
            Create club
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings" onClick={onNavigate}>
            <Settings className="size-4" />
            Manage clubs
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
