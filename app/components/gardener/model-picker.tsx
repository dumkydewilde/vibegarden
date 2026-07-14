import { Check, ChevronDown } from "lucide-react";
import { useGardener } from "./gardener-provider";
import { models } from "~/lib/models";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export function ModelPicker() {
  const { model, setModel } = useGardener();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        >
          {model.label}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {models.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => setModel(m)}
            className="gap-2 text-sm"
          >
            <Check
              className={m.id === model.id ? "size-3.5" : "size-3.5 opacity-0"}
            />
            <span>{m.label}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {m.note}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
