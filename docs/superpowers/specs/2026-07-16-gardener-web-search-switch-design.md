# Gardener web-search switch

## Goal

Make the Web search setting in the Gardener composer visibly and clearly
toggleable.

## Current behavior

The Web search entry in the composer tools menu already changes the shared
`webSearch` state. Its status is expressed only as text: `on` when enabled and
`costs a little` when disabled.

## Design

Replace the trailing status text in that menu row with an accessible Switch
whose checked state is bound to `webSearch`. Keep the Globe icon and Web search
label. The switch stops its pointer/click events from bubbling so changing it
does not cause the dropdown menu to close; selecting the remaining row keeps
the existing toggle behavior for a generous click target.

When off, the switch is unchecked; when on, it is checked. This is purely a UI
affordance: the existing provider state and the `web` value sent with chat
requests remain unchanged.

## Verification

Add a component test that opens the tools menu, asserts the switch starts off,
turns it on, and verifies the provider setter receives `true`. Run the focused
test and the project typecheck/lint command available in the package scripts.
