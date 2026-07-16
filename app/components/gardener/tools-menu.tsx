/**
 * The composer's tools button: one place for the Gardener's optional
 * capabilities. Attach a data file, add a data link (both feed the
 * browser's DuckDB for the query_data tool), and the web search toggle.
 */

import { Database, FileUp, Globe, Link2, Wrench, X } from "lucide-react";
import { useRef, useState } from "react";
import { useGardener } from "./gardener-provider";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

const ACCEPTED = ".csv,.tsv,.txt,.json,.jsonl,.ndjson,.parquet,.xlsx";

export function ToolsMenu() {
  const {
    webSearch,
    setWebSearch,
    attachDataset,
    attachingDataset,
    datasets,
    removeDataset,
  } = useGardener();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");

  const submitLink = () => {
    const url = link.trim();
    if (!url) return;
    setLinkOpen(false);
    setLink("");
    attachDataset({ kind: "url", url });
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) attachDataset({ kind: "file", file });
          e.target.value = "";
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Tools"
            title="Tools: attach data, web search"
            disabled={attachingDataset !== null}
            className={cn(
              "shrink-0 text-muted-foreground",
              webSearch && "bg-accent text-primary",
            )}
          >
            <Wrench className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-72">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Give The Gardener data to query
          </DropdownMenuLabel>
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => fileInputRef.current?.click()}
          >
            <FileUp className="size-4 shrink-0" />
            <span className="flex-1 whitespace-nowrap">Attach a data file</span>
            <span className="text-xs text-muted-foreground">
              stays in your browser
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => setLinkOpen(true)}
          >
            <Link2 className="size-4 shrink-0" />
            <span className="flex-1 whitespace-nowrap">Add a data link</span>
            <span className="text-xs text-muted-foreground">
              or paste in chat
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={cn("gap-2", webSearch && "text-primary")}
            onSelect={(e) => {
              e.preventDefault();
              setWebSearch(!webSearch);
            }}
          >
            <Globe className="size-4 shrink-0" />
            <span className="flex-1 whitespace-nowrap">Web search</span>
            <Switch
              aria-label="Web search"
              checked={webSearch}
              onCheckedChange={setWebSearch}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </DropdownMenuItem>
          {datasets.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Loaded in this conversation
              </DropdownMenuLabel>
              {datasets.map((d) => (
                <DropdownMenuItem
                  key={d.name}
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    removeDataset(d.name);
                  }}
                  title={`${d.label}: remove from this conversation`}
                >
                  <Database className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {d.rowCount.toLocaleString()} rows
                  </span>
                  <X className="size-3.5 shrink-0 text-muted-foreground" />
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif font-normal">
              Add a data link
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitLink();
            }}
          >
            <p className="text-sm text-muted-foreground">
              A direct link to a CSV, JSON, Parquet, or Excel file. Your
              browser downloads it; the data never touches a server.
            </p>
            <Input
              autoFocus
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://example.com/data.csv"
              type="url"
            />
            <Button type="submit" disabled={!link.trim()}>
              Load the data
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
