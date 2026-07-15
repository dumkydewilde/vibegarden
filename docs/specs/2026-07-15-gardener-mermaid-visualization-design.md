# Gardener Mermaid Visualization Design

## Goal

Give The Gardener an explicit tool for turning a flow into a Mermaid diagram. The diagram appears as a rendered preview in the chat, survives conversation reloads, and opens in a larger accessible dialog when selected.

## Scope

This increment includes:

- A `visualize_flow` function tool offered to every model that supports tools.
- A tool contract containing a short title and Mermaid source.
- A durable diagram marker carried inside the existing plain-text chat stream and assistant message.
- A rendered inline preview in both the live sidebar and saved conversation pages.
- A click-to-expand dialog for viewing larger diagrams.
- A readable fallback when Mermaid source is invalid or cannot render.
- Focused tests for the tool contract, marker encoding, chat rendering, expansion, and fallback.

This increment does not include diagram editing, zoom controls, image downloads, a new database attachment model, or a rewrite of the chat endpoint to structured server-sent events.

## User Experience

When a person's question would be clearer as a flow, The Gardener may call `visualize_flow`. Tool activity first appears in the same position in the response where other tool notes appear. Once the marker is complete, the chat renders a diagram card containing:

- The diagram title.
- The rendered Mermaid diagram, sized to the chat column.
- A visible expand affordance.

The whole preview is a button. Activating it by pointer or keyboard opens a dialog with the title and a larger copy of the same diagram. The dialog fits within the viewport and scrolls in either direction when the diagram is larger than the available area. Standard dialog behavior supplies focus trapping, Escape-to-close, and focus restoration.

If Mermaid rejects the source, the card shows a concise message and the source in a scrollable code block. The user can still expand the fallback to inspect it. A broken diagram does not break the surrounding assistant message.

## Tool Contract

The OpenAI-format function tool is named `visualize_flow`:

```json
{
  "title": "How a question becomes an answer",
  "diagram": "flowchart TD\n  A[Question] --> B[Gardener]\n  B --> C[Answer]"
}
```

`title` and `diagram` are required strings. The server trims both values, limits the title to 120 characters, and limits Mermaid source to 12,000 characters. Empty or oversized values produce an error result for the model and no diagram marker for the user.

The tool description tells the model to use it for flows, sequences, decision paths, and other relationships that are materially clearer as a diagram. It also tells the model to keep diagrams small and readable for people who may not be programmers. The system prompt mentions the tool alongside the existing tool-use guidance so models know the visual is returned directly to the chat and should accompany it with a short prose explanation.

Successful execution returns a short acknowledgement to the model. The diagram itself is not copied back into the final prose response.

## Chat Transport and Persistence

The chat endpoint remains a `text/plain` stream. A successful `visualize_flow` call emits a marker through the existing tool-note mechanism:

```text
[[tool:diagram:<encoded-payload>]]
```

The payload is a URI-encoded JSON object with a version, title, and Mermaid source. Encoding keeps the marker on one line even though Mermaid source contains newlines, while the version allows future payload changes to fail safely.

The marker is appended to the same `full` assistant response that is streamed and saved today. This gives the feature three properties without a schema change:

1. The diagram appears during the live response.
2. The diagram reappears when a saved conversation is loaded.
3. The marker is removed by `stripToolNotes` before history is sent back to a model.

Malformed or unknown-version payloads become inert text rather than throwing during chat rendering. Existing article, module, web, and note markers retain their current behavior.

The server must validate the tool arguments before emitting the marker. Unlike read-only activity notes, an invalid visualization call must not create a diagram marker that the client cannot use.

## Components and Boundaries

### Tool execution

`app/lib/gardener-tools.server.ts` owns the tool definition, argument validation, model-facing result, and creation of a validated diagram note. It exposes a result that lets the route distinguish a successful visualization from ordinary tools before emitting chat output.

`app/routes/api.chat.ts` keeps ownership of tool-round ordering, streaming, and persistence. It emits the diagram marker at the point where the tool ran, then adds the tool result to upstream history.

### Marker codec

`app/lib/tool-notes.ts` remains browser-safe and owns the versioned diagram payload type plus encode and decode functions. `splitToolNotes` returns a dedicated diagram segment with decoded `title` and `diagram` values. Decode failures do not throw.

### Mermaid rendering

`app/components/mermaid-block.tsx` exports the existing Mermaid renderer as a reusable component. It preserves the client-only dynamic import, theme observation, and unique render IDs that keep Mermaid out of the Cloudflare server bundle.

The renderer reports pending, rendered, and invalid states through its UI rather than requiring callers to import Mermaid or duplicate rendering logic.

### Chat presentation

A focused `app/components/gardener/mermaid-tool-result.tsx` component owns the preview card and dialog. `app/components/gardener/chat-message.tsx` maps diagram segments to this component alongside the existing tool-note bubbles.

The same `ChatMessageBubble` component renders the live sidebar and saved conversation detail, so no route-specific integration is needed.

## Data Flow

1. The model calls `visualize_flow` with a title and Mermaid source.
2. The server parses and validates the arguments.
3. On success, the server emits a versioned diagram marker into the assistant text stream.
4. The server returns an acknowledgement as the tool result and asks the model to continue.
5. The provider appends streamed text to the in-progress assistant message unchanged.
6. `splitToolNotes` decodes the marker into a diagram segment.
7. The chat component renders the segment as an inline Mermaid preview.
8. Selecting the preview opens the larger dialog.
9. The complete assistant text, including the marker, is stored in the existing chat message row.

## Error Handling

- Invalid JSON tool arguments return the existing invalid-arguments error and emit no diagram.
- Missing, empty, or oversized `title` or `diagram` values return a specific tool error and emit no diagram.
- A malformed persisted marker is treated as ordinary text so old conversation pages remain usable.
- Mermaid parse or render errors show source code in the diagram card and dialog.
- The current mid-conversation upstream failure behavior remains unchanged. A diagram already emitted before that failure remains visible.
- Multiple diagrams in one response are supported because each marker is decoded independently and Mermaid render IDs are unique.

## Accessibility and Responsive Behavior

- The preview uses a semantic button with an accessible name derived from the title.
- The expanded view uses the existing Radix-based dialog components with a visible title.
- The preview has a visible keyboard focus state and does not rely on the expand icon alone.
- The inline SVG stays within the chat width. Horizontal overflow remains available for wide diagrams.
- The dialog uses nearly the full viewport on small screens and a large bounded viewport on desktop.
- Dark and light themes continue to select Mermaid's matching theme.

## Testing

Unit and component tests will prove:

- `toolDefinitions` includes the required `visualize_flow` schema.
- Valid tool arguments produce a successful model result and diagram marker.
- Empty, malformed, and oversized arguments produce errors without a diagram marker.
- Diagram payloads round-trip titles and multiline Mermaid source through the marker codec.
- Malformed and unknown-version diagram markers fail safely.
- `stripToolNotes` excludes diagram markers from model-bound history.
- A diagram segment renders an inline preview in a Gardener message.
- Activating the preview opens a dialog with the same title and diagram.
- An invalid Mermaid render exposes the source fallback.
- Existing tool-note and chat-message tests remain green.

The final verification commands are `npm test`, `npm run typecheck`, and `npm run build`.

## Acceptance Criteria

- A tool-capable Gardener model can explicitly call `visualize_flow`.
- A valid call produces a rendered Mermaid preview inside the assistant's chat response.
- The preview is keyboard and pointer activatable and opens a larger modal view.
- The diagram remains visible after the conversation is persisted and reopened.
- Invalid input or Mermaid source degrades to a readable local error without breaking the response.
- Tool markers are not included in model-bound conversation history.
- Existing Gardener tools and MDX Mermaid diagrams continue to work.
