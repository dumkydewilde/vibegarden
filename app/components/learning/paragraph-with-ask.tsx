import { Sprout } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useGardener } from "~/components/gardener/gardener-provider";

function getContextItem(element: HTMLElement | null) {
  const text = element
    ? Array.from(element.childNodes)
        .filter(
          (node) =>
            !(
              node instanceof HTMLElement && node.dataset.askControl === "true"
            ),
        )
        .map((node) => node.textContent)
        .join("")
        .trim()
    : "";
  if (!text) return null;

  return {
    kind: "paragraph" as const,
    label:
      text.length > 44 ? `"${text.slice(0, 44).trimEnd()}..."` : `"${text}"`,
    content: text,
  };
}

function AskButton({
  ariaLabel,
  onClick,
}: {
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-ask-control="true"
      aria-label={ariaLabel}
      onClick={onClick}
      className="group/seed absolute top-0.5 -left-10 hidden rounded-md p-1.5 text-primary opacity-0 transition-opacity hover:bg-accent hover:text-primary focus-visible:opacity-100 group-hover:opacity-100 md:block"
    >
      <Sprout className="size-4" />
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-7 left-0 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover/seed:opacity-100"
      >
        Ask the Gardener
      </span>
    </button>
  );
}

/**
 * MDX paragraph override: hovering reveals a seed in the margin that plants
 * this specific paragraph in The Gardener's context.
 */
export function ParagraphWithAsk(props: React.ComponentProps<"p">) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [insideBlockquote, setInsideBlockquote] = useState(false);
  const { addContext } = useGardener();

  // Quote callouts are already visually distinct and should not be turned
  // into a sequence of Gardener prompts.
  useLayoutEffect(() => {
    setInsideBlockquote(Boolean(ref.current?.closest("blockquote")));
  }, []);

  const askAboutThis = () => {
    const contextItem = getContextItem(ref.current);
    if (contextItem) addContext(contextItem);
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
      {!insideBlockquote && (
        <AskButton
          ariaLabel="Ask The Gardener about this paragraph"
          onClick={askAboutThis}
        />
      )}
    </p>
  );
}

/** MDX list item override with the same contextual Gardener affordance. */
export function ListItemWithAsk(props: React.ComponentProps<"li">) {
  const ref = useRef<HTMLLIElement>(null);
  const { addContext } = useGardener();

  const askAboutThis = () => {
    const contextItem = getContextItem(ref.current);
    if (contextItem) addContext(contextItem);
  };

  return (
    <li
      ref={ref}
      className="group relative before:absolute before:top-0 before:-left-12 before:h-full before:w-12 before:content-['']"
      {...props}
    >
      {props.children}
      <AskButton
        ariaLabel="Ask The Gardener about this list item"
        onClick={askAboutThis}
      />
    </li>
  );
}
