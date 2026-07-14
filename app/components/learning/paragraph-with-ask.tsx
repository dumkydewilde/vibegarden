import { Sprout } from "lucide-react";
import { useRef } from "react";
import { useGardener } from "~/components/gardener/gardener-provider";

/**
 * MDX paragraph override: hovering reveals a seed in the margin that plants
 * this specific paragraph in The Gardener's context.
 */
export function ParagraphWithAsk(props: React.ComponentProps<"p">) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { addContext } = useGardener();

  const askAboutThis = () => {
    const text = ref.current?.textContent?.trim();
    if (!text) return;
    const label =
      text.length > 44 ? `"${text.slice(0, 44).trimEnd()}..."` : `"${text}"`;
    addContext({ kind: "paragraph", label, content: text });
  };

  return (
    <p
      ref={ref}
      // The before: strip extends the hover area into the left margin so the
      // seed stays visible while the cursor travels to it.
      className="group relative before:absolute before:top-0 before:-left-12 before:h-full before:w-12 before:content-['']"
      {...props}
    >
      {props.children}
      <button
        type="button"
        aria-label="Ask The Gardener about this paragraph"
        onClick={askAboutThis}
        className="group/seed absolute top-0.5 -left-10 hidden rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100 md:block"
      >
        <Sprout className="size-4" />
        <span
          role="tooltip"
          className="pointer-events-none absolute -top-7 left-0 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover/seed:opacity-100"
        >
          Ask the Gardener
        </span>
      </button>
    </p>
  );
}
