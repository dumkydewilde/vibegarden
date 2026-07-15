# Gardener Activity Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a quiet, animated Gardener status while a response or tool call is in progress, then preserve completed tool activity as the existing static records.

**Architecture:** Keep the plain-text streaming protocol unchanged. `ChatMessageBubble` will receive an `isStreaming` flag from `PanelBody`; it will render an in-row thinking status for an empty streaming message and mark only a trailing tool marker as active. A local Tailwind `shimmer` utility supplies the CSS effect without importing a new package.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vitest, Testing Library, Lucide.

## Global Constraints

- Keep tool markers and their server-side persistence behavior unchanged.
- Use a local `shimmer` utility, modelled on shadcn's text shimmer, with no dependency addition.
- Render status as visible text without an assertive live region.
- Stop animation automatically when `prefers-reduced-motion` is enabled.
- Follow Vibe Garden copy rules: no em or en dashes.
- Do not replace the existing `ScrollArea` or add shadcn chat primitives.

---

## File structure

| File | Responsibility |
| --- | --- |
| `app/components/gardener/chat-message.tsx` | Derive readable tool labels and render active versus completed Gardener activity. |
| `app/components/gardener/agent-sidebar.tsx` | Mark the newest streaming Gardener message and remove the detached pending copy. |
| `app/components/gardener/__tests__/chat-message.test.tsx` | Verify initial, active-tool, completed-tool, sequential-tool, and error rendering. |
| `app/app.css` | Provide the scoped text-shimmer utility and reduced-motion fallback. |

### Task 1: Render and test active Gardener states

**Files:**

- Create: `app/components/gardener/__tests__/chat-message.test.tsx`
- Modify: `app/components/gardener/chat-message.tsx:58-181`

**Interfaces:**

- Consumes: `ChatMessage`, `splitToolNotes(text)`, `ToolNoteSegment`, `getArticle(slug)`, and `getModule(slug)`.
- Produces: `ChatMessageBubble({ message, isStreaming? })`, where `isStreaming` defaults to `false`.
- Produces: `ActivityBubble({ label })` for an active status and `ToolNoteBubble({ segment, active? })` for a streamed tool marker.

- [ ] **Step 1: Write the failing component tests**

Create `app/components/gardener/__tests__/chat-message.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMessageBubble } from "../chat-message";
import { toolNote } from "~/lib/tool-notes";

const gardener = (text: string, error = false) => ({
  id: "g1",
  role: "gardener" as const,
  text,
  error,
});

describe("ChatMessageBubble activity", () => {
  it("shows a shimmered thinking status for an empty streaming reply", () => {
    render(<ChatMessageBubble message={gardener("")} isStreaming />);

    const status = screen.getByText("The Gardener is thinking...");
    expect(status.classList.contains("shimmer")).toBe(true);
  });

  it("shimmers the trailing article tool with its article title", () => {
    render(
      <ChatMessageBubble
        message={gardener(toolNote("article", "what-is-an-llm"))}
        isStreaming
      />,
    );

    const status = screen.getByText("Reading What is an LLM?");
    expect(status.classList.contains("shimmer")).toBe(true);
  });

  it("settles a tool into its existing static record when prose follows", () => {
    render(
      <ChatMessageBubble
        message={gardener(`${toolNote("web", "example.com")}\n\nHere is what I found.`)}
        isStreaming
      />,
    );

    expect(screen.getByText("reading example.com")).toBeTruthy();
    expect(screen.getByText("Here is what I found.").classList.contains("shimmer")).toBe(false);
  });

  it("only shimmers the newest trailing tool", () => {
    render(
      <ChatMessageBubble
        message={gardener(`${toolNote("article", "what-is-an-llm")}\n\n${toolNote("web", "example.com")}`)}
        isStreaming
      />,
    );

    expect(screen.getByText("reading")).toBeTruthy();
    const status = screen.getByText("Checking example.com");
    expect(status.classList.contains("shimmer")).toBe(true);
  });

  it("does not leave an activity shimmer on an error reply", () => {
    render(
      <ChatMessageBubble
        message={gardener("The Gardener could not answer just now.", true)}
        isStreaming
      />,
    );

    expect(screen.queryByText("The Gardener is thinking...")).toBeNull();
    expect(screen.getByText("The Gardener could not answer just now.").classList.contains("shimmer")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- app/components/gardener/__tests__/chat-message.test.tsx
```

Expected: FAIL because `ChatMessageBubble` does not accept `isStreaming` and no thinking or active-tool status is rendered.

- [ ] **Step 3: Implement active and completed activity rendering**

In `app/components/gardener/chat-message.tsx`, add these helpers before `ToolNoteBubble`:

```tsx
function ActivityBubble({ label }: { label: string }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
      <span className="shimmer">{label}</span>
    </div>
  );
}

function toolActivityLabel(
  segment: Extract<ToolNoteSegment, { type: "tool" }>,
) {
  if (segment.kind === "article") {
    return `Reading ${getArticle(segment.value)?.meta.title ?? "an article"}`;
  }
  if (segment.kind === "module") {
    return `Reading ${getModule(segment.value)?.meta.title ?? "a building block"}`;
  }
  if (segment.kind === "web") return `Checking ${segment.value}`;
  return segment.value.charAt(0).toUpperCase() + segment.value.slice(1);
}
```

Change the tool bubble signature and begin it with the active presentation:

```tsx
function ToolNoteBubble({
  segment,
  active = false,
}: {
  segment: Extract<ToolNoteSegment, { type: "tool" }>;
  active?: boolean;
}) {
  if (active) return <ActivityBubble label={toolActivityLabel(segment)} />;

  const wrapper =
    "flex max-w-full items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs italic text-muted-foreground";
  // Keep the existing article, module, web, and note records below unchanged.
}
```

Update `ChatMessageBubble` to derive the one active marker and preserve the existing non-streaming output:

```tsx
export function ChatMessageBubble({
  message,
  isStreaming = false,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
}) {
  const isGardener = message.role === "gardener";
  const segments = isGardener ? splitToolNotes(message.text) : [];
  const activeToolIndex =
    isStreaming && !message.error && segments.at(-1)?.type === "tool"
      ? segments.length - 1
      : -1;

  // In the Gardener branch, replace the existing empty Bubble condition with:
  // {segments.length === 0 &&
  //   (isStreaming && !message.error && !message.text ? (
  //     <ActivityBubble label="The Gardener is thinking..." />
  //   ) : (
  //     <GardenerTextBubble text="" error={message.error} />
  //   ))}
  // Pass active={i === activeToolIndex} to each ToolNoteBubble.
}
```

Keep `GardenerTextBubble` and all user-message rendering unchanged.

- [ ] **Step 4: Run the focused tests to verify the implementation passes**

Run:

```bash
npm test -- app/components/gardener/__tests__/chat-message.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit the tested renderer**

```bash
git add app/components/gardener/chat-message.tsx app/components/gardener/__tests__/chat-message.test.tsx
git commit -m "feat: show gardener activity states"
```

### Task 2: Connect streaming state and add the shimmer utility

**Files:**

- Modify: `app/components/gardener/agent-sidebar.tsx:80-104`
- Modify: `app/app.css:1-7`

**Interfaces:**

- Consumes: `messages: ChatMessage[]` and `busy: boolean` from `useGardener()`.
- Consumes: `ChatMessageBubble({ message, isStreaming? })` from Task 1.
- Produces: `shimmer` Tailwind utility with its own reduced-motion fallback.

- [ ] **Step 1: Add the focused panel-state test**

Extend `app/components/gardener/__tests__/chat-message.test.tsx` with a non-streaming regression case:

```tsx
it("renders an empty completed Gardener message without a shimmer", () => {
  render(<ChatMessageBubble message={gardener("")} />);

  expect(screen.queryByText("The Gardener is thinking...")).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it passes before wiring**

Run:

```bash
npm test -- app/components/gardener/__tests__/chat-message.test.tsx
```

Expected: PASS, 6 tests. This locks in that the status is controlled by the `isStreaming` flag, rather than an empty message alone.

- [ ] **Step 3: Pass streaming state from the chat panel**

In `PanelBody` in `app/components/gardener/agent-sidebar.tsx`, replace the map and remove the detached pending paragraph:

```tsx
{messages.map((m, index) => (
  <ChatMessageBubble
    key={m.id}
    message={m}
    isStreaming={busy && index === messages.length - 1 && m.role === "gardener"}
  />
))}
```

Delete this obsolete block entirely:

```tsx
{busy && messages[messages.length - 1]?.text === "" && (
  <p className="pl-9 text-xs text-muted-foreground">
    The Gardener is thinking...
  </p>
)}
```

Near the top of `app/app.css`, after the imports and before the theme tokens, add:

```css
@keyframes gardener-shimmer {
  to {
    background-position: -200% 0;
  }
}

@utility shimmer {
  background-image: linear-gradient(
    110deg,
    var(--muted-foreground) 35%,
    color-mix(in oklch, var(--muted-foreground) 35%, white) 50%,
    var(--muted-foreground) 65%
  );
  background-size: 200% 100%;
  background-clip: text;
  color: transparent;
  animation: gardener-shimmer 2s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    background-image: none;
    color: var(--muted-foreground);
    animation: none;
  }
}
```

- [ ] **Step 4: Run automated verification**

Run:

```bash
npm test -- app/components/gardener/__tests__/chat-message.test.tsx
npm run typecheck
npm test
```

Expected: all commands exit 0. The first command reports 6 passing activity tests, `typecheck` reports no TypeScript errors, and the full Vitest suite passes.

- [ ] **Step 5: Perform the visual checks**

Run `npm run dev`, then use the Gardener panel to verify:

1. Submitting a question shows exactly one in-row shimmered thinking bubble.
2. A response that calls `read_article`, `read_module`, `fetch_page`, or `fresh_reads` changes that bubble to the relevant label while the tool runs.
3. Once prose follows, each completed tool reverts to its existing static card or note.
4. In system reduced-motion mode, every status label remains readable but still.
5. Light and dark themes retain legible muted status text.

- [ ] **Step 6: Commit the integration and styles**

```bash
git add app/components/gardener/agent-sidebar.tsx app/app.css app/components/gardener/__tests__/chat-message.test.tsx
git commit -m "feat: shimmer active gardener work"
```

## Self-review

- Spec coverage: Task 1 covers initial thinking, each tool label, completed markers, multiple tools, and errors. Task 2 connects actual `busy` state, defines the CSS animation, honours reduced motion, and specifies visual verification in both themes.
- Scope: The plan leaves the server protocol, persistence, `ScrollArea`, and newer shadcn chat primitives untouched.
- Types: `ChatMessageBubble` is the only changed public component interface; its optional `isStreaming` prop defaults to `false`, so existing call sites remain valid.
- No-placeholder check: this plan contains no incomplete or deferred implementation steps.
