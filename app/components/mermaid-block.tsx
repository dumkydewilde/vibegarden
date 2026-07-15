import {
  isValidElement,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

/** MDX `pre` replacement: renders ```mermaid fences as diagrams, anything else as a plain code block. */
export function MdxPre(props: ComponentProps<"pre">) {
  const child = props.children;
  if (isValidElement(child)) {
    const { className, children } = child.props as {
      className?: string;
      children?: ReactNode;
    };
    if (className?.includes("language-mermaid")) {
      return (
        <MermaidDiagram
          code={String(children ?? "").trim()}
          fallback={<pre {...props} />}
        />
      );
    }
  }
  return <pre {...props} />;
}

function MermaidDiagram({
  code,
  fallback,
}: {
  code: string;
  fallback: ReactNode;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, "");

  // Follow the html.dark class so diagrams switch along with the theme toggle.
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // The SSR guard lets the server build drop mermaid entirely; the worker
    // bundle is close to Cloudflare's size limit and mermaid is huge.
    if (import.meta.env.SSR) return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
          fontFamily: "var(--font-sans)",
        });
        const rendered = await mermaid.render(`mermaid-${renderId}`, code);
        if (!cancelled) setSvg(rendered.svg);
      } catch {
        // Invalid diagram source: keep showing the code fence.
        if (!cancelled) setSvg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, dark, renderId]);

  if (!svg) return fallback;
  return (
    <div
      className="mermaid-diagram"
      role="img"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
