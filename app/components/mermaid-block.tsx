import {
  isValidElement,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "~/lib/utils";

const GARDEN_MERMAID_THEME = {
  light: {
    background: "#fffcf5",
    primaryColor: "#e2f2e5",
    primaryBorderColor: "#5f8869",
    primaryTextColor: "#26362b",
    secondaryColor: "#eef5e8",
    tertiaryColor: "#f6f0dc",
    lineColor: "#315c41",
    arrowheadColor: "#315c41",
    edgeLabelBackground: "#fffcf5",
    clusterBkg: "#f3f6ec",
    clusterBorder: "#87a78d",
  },
  dark: {
    background: "#202823",
    primaryColor: "#304a38",
    primaryBorderColor: "#78a985",
    primaryTextColor: "#f0f5ef",
    secondaryColor: "#394b37",
    tertiaryColor: "#4a4431",
    lineColor: "#9dc3a4",
    arrowheadColor: "#9dc3a4",
    edgeLabelBackground: "#202823",
    clusterBkg: "#26332a",
    clusterBorder: "#5f8068",
  },
} as const;

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

type MermaidRenderState =
  | { status: "loading" }
  | { status: "rendered"; svg: string }
  | { status: "error" };

type MermaidDiagramProps = {
  code: string;
  fallback: ReactNode;
  loadingFallback?: ReactNode;
  ariaLabel?: string;
  className?: string;
};

export function MermaidDiagram({
  code,
  fallback,
  loadingFallback = fallback,
  ariaLabel,
  className,
}: MermaidDiagramProps) {
  const [state, setState] = useState<MermaidRenderState>({
    status: "loading",
  });
  const [dark, setDark] = useState(
    () =>
      !import.meta.env.SSR &&
      document.documentElement.classList.contains("dark"),
  );
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
    setState({ status: "loading" });
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: dark
            ? GARDEN_MERMAID_THEME.dark
            : GARDEN_MERMAID_THEME.light,
          fontFamily: "var(--font-sans)",
        });
        const rendered = await mermaid.render(`mermaid-${renderId}`, code);
        if (!cancelled) {
          setState({ status: "rendered", svg: rendered.svg });
        }
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, dark, renderId]);

  if (state.status === "loading") return loadingFallback;
  if (state.status === "error") return fallback;
  return (
    <div
      className={cn("mermaid-diagram", className)}
      role="img"
      aria-label={ariaLabel}
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
