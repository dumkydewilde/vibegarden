# Gardener Mermaid Visualization Implementation Plan

**Goal:** Add an explicit `visualize_flow` Gardener tool that renders a durable inline Mermaid preview in chat and opens the same diagram in a large accessible dialog.

**Architecture:** Keep the current plain-text stream and D1 message schema. Encode validated diagram data in a versioned one-line tool marker, decode it into a typed chat segment, and reuse the client-only Mermaid renderer in a focused preview/dialog component.

**Tech Stack:** TypeScript, React 19, React Router 8 framework mode, Cloudflare Workers, Mermaid 11.15, Radix Dialog through shadcn/ui, Vitest, React Testing Library, Tailwind CSS 4.

## Global Constraints

- Tool name: `visualize_flow`.
- Tool arguments: required `title` and `diagram` strings.
- Trim both values, limit titles to 120 characters, and limit Mermaid source to 12,000 characters.
- Keep the chat response as `text/plain`; do not add a database migration or structured SSE protocol.
- Marker format: `[[tool:diagram:<URI-encoded versioned JSON payload>]]` on one line.
- Persist the marker in the existing assistant message and strip it from model-bound history.
- Keep Mermaid behind the existing client-only dynamic import so the Cloudflare server bundle stays unchanged.
- Invalid tool input emits no diagram marker. Invalid Mermaid source shows a readable source fallback.
- The inline preview is keyboard and pointer activatable and uses the existing Radix-based dialog.
- Do not add editing, zoom controls, image downloads, or new dependencies.
- Follow repository copy style: no em or en dashes.

---

### Task 1: Versioned Diagram Marker Codec

**Files:**
- Modify: `app/lib/tool-notes.ts:9-53`
- Test: `app/lib/__tests__/tool-notes.test.ts:1-51`

**Interfaces:**
- Produces: `DiagramPayload = { version: 1; title: string; diagram: string }`.
- Produces: `diagramNote(payload: Omit<DiagramPayload, "version">): string`.
- Produces: `ToolNoteSegment` variant `{ type: "diagram"; title: string; diagram: string }`.
- Preserves: `toolNote`, existing tool segments, and `stripToolNotes(text): string`.

- [ ] **Step 1: Add failing codec and history tests**

Add `diagramNote` to the import and these cases to `app/lib/__tests__/tool-notes.test.ts`:

```ts
import {
  diagramNote,
  splitToolNotes,
  stripToolNotes,
  toolNote,
} from "~/lib/tool-notes";

const diagram = {
  title: "How questions become answers",
  diagram: "flowchart TD\n  A[Question] --> B[Answer]",
};

it("round-trips a titled multiline diagram", () => {
  const marker = diagramNote(diagram);

  expect(marker).not.toContain("\n");
  expect(splitToolNotes(marker)).toEqual([{ type: "diagram", ...diagram }]);
});

it("keeps malformed and unknown diagram markers as text", () => {
  expect(splitToolNotes("[[tool:diagram:not-json]]")).toEqual([
    { type: "text", text: "[[tool:diagram:not-json]]" },
  ]);
  const future = encodeURIComponent(
    JSON.stringify({ version: 2, title: "Future", diagram: "flowchart TD" }),
  );
  expect(splitToolNotes(`[[tool:diagram:${future}]]`)).toEqual([
    { type: "text", text: `[[tool:diagram:${future}]]` },
  ]);
});

it("strips a valid diagram marker from model-bound history", () => {
  const text = `Before.\n\n${diagramNote(diagram)}\n\nAfter.`;
  expect(stripToolNotes(text)).toBe("Before.\n\nAfter.");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- app/lib/__tests__/tool-notes.test.ts`

Expected: FAIL because `diagramNote` is not exported and diagram markers are not decoded.

- [ ] **Step 3: Implement the versioned marker codec**

Replace the types, marker constants, and parsing loop in `app/lib/tool-notes.ts` with this implementation while retaining the existing file comment:

```ts
export type ToolNoteKind = "article" | "module" | "web" | "note";

export type DiagramPayload = {
  version: 1;
  title: string;
  diagram: string;
};

export type ToolNoteSegment =
  | { type: "text"; text: string }
  | { type: "tool"; kind: ToolNoteKind; value: string }
  | { type: "diagram"; title: string; diagram: string };

const NOTE_LINE = /^\[\[tool:(article|module|web|note):(.+?)\]\]$/;
const DIAGRAM_LINE = /^\[\[tool:diagram:(.+?)\]\]$/;

export function toolNote(kind: ToolNoteKind, value: string): string {
  return `[[tool:${kind}:${value}]]`;
}

export function diagramNote(
  payload: Omit<DiagramPayload, "version">,
): string {
  return `[[tool:diagram:${encodeURIComponent(
    JSON.stringify({ version: 1, ...payload } satisfies DiagramPayload),
  )}]]`;
}

function decodeDiagram(value: string): DiagramPayload | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<DiagramPayload>;
    return parsed.version === 1 &&
      typeof parsed.title === "string" &&
      typeof parsed.diagram === "string"
      ? { version: 1, title: parsed.title, diagram: parsed.diagram }
      : null;
  } catch {
    return null;
  }
}

export function splitToolNotes(text: string): ToolNoteSegment[] {
  const segments: ToolNoteSegment[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const chunk = buffer.join("\n").trim();
    if (chunk) segments.push({ type: "text", text: chunk });
    buffer = [];
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const diagramMatch = trimmed.match(DIAGRAM_LINE);
    if (diagramMatch) {
      const payload = decodeDiagram(diagramMatch[1]);
      if (payload) {
        flush();
        segments.push({
          type: "diagram",
          title: payload.title,
          diagram: payload.diagram,
        });
      } else {
        buffer.push(line);
      }
      continue;
    }

    const noteMatch = trimmed.match(NOTE_LINE);
    if (noteMatch) {
      flush();
      segments.push({
        type: "tool",
        kind: noteMatch[1] as ToolNoteKind,
        value: noteMatch[2],
      });
    } else {
      buffer.push(line);
    }
  }

  flush();
  return segments;
}

export function stripToolNotes(text: string): string {
  return splitToolNotes(text)
    .filter((segment) => segment.type === "text")
    .map((segment) => segment.text)
    .join("\n\n");
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- app/lib/__tests__/tool-notes.test.ts`

Expected: PASS for existing notes, diagram round-trip, safe malformed payloads, and history stripping.

- [ ] **Step 5: Commit the codec**

```bash
git add app/lib/tool-notes.ts app/lib/__tests__/tool-notes.test.ts
git commit -m "feat: encode Mermaid tool results in chat"
```

---

### Task 2: Gardener Tool Definition, Validation, Prompt, and Stream Emission

**Files:**
- Modify: `app/lib/gardener-tools.server.ts:8-263`
- Modify: `app/lib/gardener.server.ts:47-68`
- Modify: `app/routes/api.chat.ts:170-180`
- Test: `app/lib/__tests__/gardener-tools.test.ts:1-105`
- Test: `app/lib/__tests__/gardener.test.ts:24-46`

**Interfaces:**
- Consumes: `diagramNote({ title, diagram }): string` from Task 1.
- Produces: `DIAGRAM_TITLE_MAX_CHARS = 120` and `DIAGRAM_SOURCE_MAX_CHARS = 12_000`.
- Produces: `toolNoteFor(call: ToolCall): string | null`, returning `null` only when a visualization call is invalid.
- Preserves: `executeTool(call, env): Promise<string>` for upstream tool results.

- [ ] **Step 1: Add failing tool schema, validation, and prompt tests**

Extend `app/lib/__tests__/gardener-tools.test.ts` with `toolDefinitions` in the import and these cases:

```ts
it("offers a required titled Mermaid visualization tool", () => {
  const definition = toolDefinitions(env).find(
    (item) => item.function.name === "visualize_flow",
  );
  expect(definition).toMatchObject({
    type: "function",
    function: {
      name: "visualize_flow",
      parameters: {
        type: "object",
        required: ["title", "diagram"],
        properties: {
          title: { type: "string" },
          diagram: { type: "string" },
        },
      },
    },
  });
});

it("acknowledges and emits a marker for a valid flow", async () => {
  const flow = call("visualize_flow", {
    title: " Request flow ",
    diagram: " flowchart TD\n  A --> B ",
  });
  expect(await executeTool(flow, env)).toBe(
    'Diagram "Request flow" is ready. Briefly explain what it shows.',
  );
  expect(toolNoteFor(flow)).toContain("[[tool:diagram:");
});

it("rejects empty and oversized flows without emitting a marker", async () => {
  const empty = call("visualize_flow", { title: "", diagram: "flowchart TD" });
  expect(await executeTool(empty, env)).toContain("title is required");
  expect(toolNoteFor(empty)).toBeNull();

  const oversized = call("visualize_flow", {
    title: "Large flow",
    diagram: "x".repeat(12_001),
  });
  expect(await executeTool(oversized, env)).toContain("12,000 characters");
  expect(toolNoteFor(oversized)).toBeNull();
});
```

Extend the existing tool prompt test in `app/lib/__tests__/gardener.test.ts`:

```ts
expect(withTools).toContain("visualize_flow(title, diagram)");
expect(withTools).toContain("returned directly in the chat");
```

- [ ] **Step 2: Run focused server tests and verify RED**

Run: `npm test -- app/lib/__tests__/gardener-tools.test.ts app/lib/__tests__/gardener.test.ts`

Expected: FAIL because the tool, validation, and prompt guidance do not exist.

- [ ] **Step 3: Add the tool contract and shared validation**

Import `diagramNote` beside `toolNote`, export the limits, add this definition to `baseDefinitions`, and add the validation helper in `app/lib/gardener-tools.server.ts`:

```ts
export const TOOL_RESULT_MAX_CHARS = 20_000;
export const DIAGRAM_TITLE_MAX_CHARS = 120;
export const DIAGRAM_SOURCE_MAX_CHARS = 12_000;

const visualizeFlowDefinition = {
  type: "function" as const,
  function: {
    name: "visualize_flow",
    description:
      "Render a Mermaid diagram directly in the chat. Use it when a flow, sequence, decision path, or relationship is materially clearer as a visual. Keep the diagram small, readable, and useful to someone who may not program.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "A short human-readable title for the diagram.",
        },
        diagram: {
          type: "string",
          description: "Valid Mermaid source, including its diagram type.",
        },
      },
      required: ["title", "diagram"],
    },
  },
};

type ValidFlow = { title: string; diagram: string };
type FlowValidation = { value: ValidFlow; error?: never } | { value?: never; error: string };

function validateFlow(args: Record<string, unknown>): FlowValidation {
  if (typeof args.title !== "string" || !args.title.trim()) {
    return { error: "Error: diagram title is required." };
  }
  if (typeof args.diagram !== "string" || !args.diagram.trim()) {
    return { error: "Error: Mermaid diagram source is required." };
  }
  const title = args.title.trim();
  const diagram = args.diagram.trim();
  if (title.length > DIAGRAM_TITLE_MAX_CHARS) {
    return { error: "Error: diagram title must be 120 characters or fewer." };
  }
  if (diagram.length > DIAGRAM_SOURCE_MAX_CHARS) {
    return { error: "Error: Mermaid diagram source must be 12,000 characters or fewer." };
  }
  return { value: { title, diagram } };
}
```

Include `visualizeFlowDefinition` as the fourth entry in `baseDefinitions`. Add this `executeTool` switch branch before `fetch_page`:

```ts
case "visualize_flow": {
  const flow = validateFlow(args);
  return flow.error
    ? flow.error
    : `Diagram "${flow.value.title}" is ready. Briefly explain what it shows.`;
}
```

Change `toolNoteFor` to return `string | null` and add this branch:

```ts
case "visualize_flow": {
  const flow = validateFlow(args);
  return flow.error ? null : diagramNote(flow.value);
}
```

- [ ] **Step 4: Add model guidance and emit only validated markers**

Add this line to the tool list in `buildToolsRule` in `app/lib/gardener.server.ts`:

```ts
"- visualize_flow(title, diagram): render a Mermaid flow, sequence, decision path, or relationship directly in the chat. Use it only when the visual is clearer than prose, keep it small, and follow it with a short explanation.",
```

Replace the route's unconditional note emission in `app/routes/api.chat.ts` with:

```ts
for (const call of result.toolCalls) {
  const note = toolNoteFor(call);
  if (note) {
    emit(
      `${full && !full.endsWith("\n\n") ? "\n\n" : ""}${note}\n\n`,
    );
  }
  upstreamMessages.push({
    role: "tool",
    tool_call_id: call.id,
    content: await executeTool(call, env),
  });
}
```

- [ ] **Step 5: Run focused server tests and verify GREEN**

Run: `npm test -- app/lib/__tests__/gardener-tools.test.ts app/lib/__tests__/gardener.test.ts`

Expected: PASS for the tool schema, validation limits, marker generation, and prompt guidance.

- [ ] **Step 6: Commit the Gardener tool integration**

```bash
git add app/lib/gardener-tools.server.ts app/lib/gardener.server.ts app/routes/api.chat.ts app/lib/__tests__/gardener-tools.test.ts app/lib/__tests__/gardener.test.ts
git commit -m "feat: let Gardener visualize flows"
```

---

### Task 3: Reusable Mermaid Renderer With Explicit States

**Files:**
- Modify: `app/components/mermaid-block.tsx:1-84`
- Create: `app/components/__tests__/mermaid-block.test.tsx`

**Interfaces:**
- Produces: exported `MermaidDiagram({ code, fallback, loadingFallback?, ariaLabel?, className? })`.
- Preserves: `MdxPre(props)` behavior, client-only dynamic import, theme observation, and unique render IDs.
- Consumed by: `MermaidToolResult` in Task 4.

- [ ] **Step 1: Add failing renderer state tests**

Create `app/components/__tests__/mermaid-block.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidDiagram } from "../mermaid-block";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
});

describe("MermaidDiagram", () => {
  it("renders an accessible SVG after its loading state", async () => {
    mermaid.render.mockResolvedValue({ svg: "<svg><text>Flow</text></svg>" });
    render(
      <MermaidDiagram
        code="flowchart TD; A-->B"
        ariaLabel="Request flow"
        loadingFallback={<p>Rendering flow...</p>}
        fallback={<p>Could not render flow.</p>}
      />,
    );

    expect(screen.getByText("Rendering flow...")).toBeInTheDocument();
    const image = await screen.findByRole("img", { name: "Request flow" });
    expect(image).toContainHTML("<text>Flow</text>");
  });

  it("shows the supplied fallback when Mermaid rejects the source", async () => {
    mermaid.render.mockRejectedValue(new Error("bad Mermaid"));
    render(
      <MermaidDiagram
        code="not Mermaid"
        loadingFallback={<p>Rendering flow...</p>}
        fallback={<pre>not Mermaid</pre>}
      />,
    );

    expect(await screen.findByText("not Mermaid")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `npm test -- app/components/__tests__/mermaid-block.test.tsx`

Expected: FAIL because `MermaidDiagram` is not exported and has no loading or accessible-label API.

- [ ] **Step 3: Export the renderer and model loading, success, and error states**

Import `cn` from `~/lib/utils`, define `MermaidDiagramProps`, export the component, and replace the nullable SVG state with:

```tsx
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
  const [state, setState] = useState<MermaidRenderState>({ status: "loading" });
  const [dark, setDark] = useState(false);
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (import.meta.env.SSR) return;
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
          fontFamily: "var(--font-sans)",
        });
        const rendered = await mermaid.render(`mermaid-${renderId}`, code);
        if (!cancelled) setState({ status: "rendered", svg: rendered.svg });
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
```

Keep `MdxPre` calling `MermaidDiagram` with its existing code-fence fallback. This makes that fallback serve as both loading and invalid states, preserving current MDX behavior.

- [ ] **Step 4: Run the renderer and existing MDX-adjacent tests**

Run: `npm test -- app/components/__tests__/mermaid-block.test.tsx app/components/learning/__tests__/paragraph-with-ask.test.tsx`

Expected: PASS with successful rendering, invalid-source fallback, and no MDX regression.

- [ ] **Step 5: Commit the reusable renderer**

```bash
git add app/components/mermaid-block.tsx app/components/__tests__/mermaid-block.test.tsx
git commit -m "refactor: reuse Mermaid renderer in chat"
```

---

### Task 4: Inline Chat Preview and Expandable Dialog

**Files:**
- Create: `app/components/gardener/mermaid-tool-result.tsx`
- Modify: `app/components/gardener/chat-message.tsx:1-168`
- Modify: `app/components/gardener/__tests__/chat-message.test.tsx:1-91`

**Interfaces:**
- Consumes: diagram segments from `splitToolNotes` in Task 1.
- Consumes: `MermaidDiagram` from Task 3.
- Produces: `MermaidToolResult({ title, diagram })` with a semantic preview button and Radix dialog.
- Preserves: existing text and tool activity rendering, including trailing-tool shimmer behavior.

- [ ] **Step 1: Add a failing chat preview and dialog test**

Update imports in `app/components/gardener/__tests__/chat-message.test.tsx`, mock only the renderer, and add this case:

```tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diagramNote, toolNote } from "~/lib/tool-notes";

vi.mock("~/components/mermaid-block", () => ({
  MermaidDiagram: ({ code, ariaLabel }: { code: string; ariaLabel?: string }) => (
    <div role="img" aria-label={ariaLabel}>{code}</div>
  ),
}));

it("renders a diagram preview and opens a larger dialog", () => {
  const title = "How questions become answers";
  const diagram = "flowchart TD\n  A[Question] --> B[Answer]";
  renderMessage(
    <ChatMessageBubble message={gardener(diagramNote({ title, diagram }))} />,
  );

  const trigger = screen.getByRole("button", {
    name: `Expand diagram: ${title}`,
  });
  expect(within(trigger).getByRole("img", { name: title })).toHaveTextContent(
    diagram,
  );

  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: title })).toBeInTheDocument();
  expect(within(dialog).getByRole("img", { name: title })).toHaveTextContent(
    diagram,
  );
});
```

- [ ] **Step 2: Run the chat component test and verify RED**

Run: `npm test -- app/components/gardener/__tests__/chat-message.test.tsx`

Expected: FAIL because diagram segments are passed to `ToolNoteBubble` and no preview button or dialog exists.

- [ ] **Step 3: Implement the focused preview and dialog component**

Create `app/components/gardener/mermaid-tool-result.tsx`:

```tsx
import { Expand } from "lucide-react";
import { MermaidDiagram } from "~/components/mermaid-block";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";

function DiagramFallback({ diagram }: { diagram: string }) {
  return (
    <div className="space-y-2 text-left">
      <p className="text-xs text-muted-foreground">
        This diagram could not be rendered. Here is its Mermaid source.
      </p>
      <pre className="max-w-full overflow-auto rounded-md bg-muted p-3 text-xs">
        <code>{diagram}</code>
      </pre>
    </div>
  );
}

function DiagramLoading() {
  return <p className="py-8 text-center text-xs text-muted-foreground">Rendering flow...</p>;
}

export function MermaidToolResult({
  title,
  diagram,
}: {
  title: string;
  diagram: string;
}) {
  const fallback = <DiagramFallback diagram={diagram} />;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Expand diagram: ${title}`}
          className="group w-full overflow-hidden rounded-lg border bg-background text-left shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm font-medium">
            <span>{title}</span>
            <Expand className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
          </span>
          <span className="block max-h-72 overflow-auto p-3">
            <MermaidDiagram
              code={diagram}
              ariaLabel={title}
              loadingFallback={<DiagramLoading />}
              fallback={fallback}
            />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-[90vw] flex-col sm:max-w-[80rem]">
        <DialogHeader>
          <DialogTitle className="pr-8 font-serif font-normal">{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background p-4">
          <MermaidDiagram
            code={diagram}
            ariaLabel={title}
            loadingFallback={<DiagramLoading />}
            fallback={fallback}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Route diagram segments to the new component**

Import `MermaidToolResult` into `app/components/gardener/chat-message.tsx` and replace the segment mapping expression with:

```tsx
{segments.map((segment, i) =>
  segment.type === "text" ? (
    <GardenerTextBubble
      key={i}
      text={segment.text}
      error={message.error}
    />
  ) : segment.type === "diagram" ? (
    <MermaidToolResult
      key={i}
      title={segment.title}
      diagram={segment.diagram}
    />
  ) : (
    <ToolNoteBubble
      key={i}
      segment={segment}
      active={i === activeToolIndex}
    />
  ),
)}
```

No change is needed in the provider or saved-conversation route because both already preserve assistant text and both render `ChatMessageBubble`.

- [ ] **Step 5: Run the chat and marker tests and verify GREEN**

Run: `npm test -- app/components/gardener/__tests__/chat-message.test.tsx app/lib/__tests__/tool-notes.test.ts`

Expected: PASS for inline preview, dialog expansion, existing activity bubbles, and persisted marker decoding.

- [ ] **Step 6: Commit the chat presentation**

```bash
git add app/components/gardener/mermaid-tool-result.tsx app/components/gardener/chat-message.tsx app/components/gardener/__tests__/chat-message.test.tsx
git commit -m "feat: expand Gardener diagrams from chat"
```

---

### Task 5: Roadmap, Full Verification, and Runtime Acceptance

**Files:**
- Modify: `docs/ROADMAP.md:106-112`

**Interfaces:**
- Consumes: the completed tool, marker codec, renderer, and chat UI from Tasks 1 through 4.
- Produces: repository-level evidence that all acceptance criteria pass together.

- [ ] **Step 1: Record the completed feature in the roadmap**

Add this checked item after the existing Batch 3 Mermaid entry in `docs/ROADMAP.md`:

```md
- [x] The Gardener can call `visualize_flow` to return a durable Mermaid
      preview in chat; selecting the preview opens a large accessible dialog
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: all Vitest files and tests PASS with no unhandled errors.

- [ ] **Step 3: Run type checking**

Run: `npm run typecheck`

Expected: React Router type generation and `tsc` complete with exit code 0.

- [ ] **Step 4: Build the production bundles**

Run: `npm run build`

Expected: client and Cloudflare Worker builds complete with exit code 0, and Mermaid remains in a lazy client chunk rather than the Worker entry bundle.

- [ ] **Step 5: Verify the interaction in the local app**

Run: `npm run dev`

In an authenticated conversation, ask The Gardener: `Visualize the flow from asking a question to getting an answer.` Confirm all of the following:

1. The model calls `visualize_flow` and a rendered preview appears inline.
2. The response includes a short prose explanation after the preview.
3. Pointer click and keyboard activation open the large dialog.
4. Escape closes the dialog and returns focus to the preview.
5. Reloading or opening the saved conversation renders the same preview.
6. Light and dark themes both produce legible diagrams.

If the configured model does not choose the tool for that wording, temporarily use the existing API/tool unit evidence plus a saved marker fixture in React DevTools to verify the UI. Do not weaken the prompt or force the tool for every answer.

- [ ] **Step 6: Review the final diff against the design acceptance criteria**

Run:

```bash
git diff origin/main... --check
git status --short
git log --oneline origin/main..
```

Expected: no whitespace errors, only the design/plan and scoped feature files differ from `origin/main`, and no unrelated user changes are staged.

- [ ] **Step 7: Commit roadmap and any verification-only adjustment**

```bash
git add docs/ROADMAP.md
git commit -m "docs: record Gardener flow visualizations"
```
