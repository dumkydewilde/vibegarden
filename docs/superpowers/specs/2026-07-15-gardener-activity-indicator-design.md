# Gardener activity indicator design

## Purpose

Make the Gardener's wait states feel alive and informative without adding
visual noise to the chat panel. The indicator must distinguish the initial
model wait from first-party tool work, while retaining the existing tool
activity record after the work completes.

## Interaction

1. When a question is sent, the existing empty Gardener reply renders a
   muted, shimmered status bubble: "The Gardener is thinking...".
2. When the server emits a tool marker, the pending status changes to a
   shimmered, tool-specific label:
   - `read_article`: "Reading <article title>"
   - `read_module`: "Reading <module title>"
   - `fetch_page`: "Checking <hostname>"
   - `fresh_reads`: "Looking for fresh reads" with the supplied topic when
     available
3. Once another streamed segment follows that marker, the corresponding tool
   entry becomes the existing static activity bubble or card and no longer
   animates. The next pending state is either a new tool marker or streamed
   prose.
4. When the reply completes, no activity indicator remains in motion.

## Presentation and accessibility

- The indicator lives in the existing Gardener message row, beside the
  sprout avatar. It replaces the detached "The Gardener is thinking..." text.
- Use shadcn's text `shimmer` utility on the current status only. The effect
  uses existing muted and accent colors and does not introduce a spinner,
  skeleton response, or a new dependency.
- Add a `prefers-reduced-motion` fallback that leaves the status text visible
  and static.
- The status is ordinary visible text. Do not add an assertive live region,
  because streaming and repeated tool rounds would otherwise generate noisy
  announcements.

## Data and rendering

- Keep the current plain-text streaming protocol. Tool markers already arrive
  before `executeTool` begins, so no server API or persistence change is
  needed.
- Have the chat message renderer receive enough context to identify the
  in-progress Gardener message.
- While that message is still streaming, render only its newest trailing tool
  marker as active. Earlier markers remain static activity records. Before
  any marker or prose has arrived, render the thinking state.
- Tool markers remain excluded from the model-bound history as they are now.

## Error handling and verification

- If the stream fails, replace the pending status with the existing error
  bubble. Do not leave an animation running.
- Test the renderer for: initial waiting, each tool label, a completed tool
  marker followed by prose, multiple sequential tools, and an error reply.
- Check the panel visually in light and dark mode, plus reduced-motion mode.

## Scope

This change does not replace the chat scroll container, add shadcn's newer
chat primitives, or change how tools execute. Those can be considered
separately if streaming-scroll behavior becomes a problem.
