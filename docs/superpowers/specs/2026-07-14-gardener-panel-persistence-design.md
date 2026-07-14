# Gardener panel persistence

**Date:** 2026-07-14  
**Status:** Approved design

## Goal

Keep The Gardener chat panel open while a user navigates between application pages, and restore its most recently chosen open/closed state after a browser refresh or later visit.

## Scope

- Persist only the panel's open/closed preference in browser-local storage.
- Apply the same preference to the desktop rail and mobile sheet.
- Keep an explicit close action authoritative: a closed panel stays closed after navigation and refresh.
- Preserve the existing behavior that contextual actions and resumed conversations open the panel.

## Design

`GardenerProvider` owns the single `open` state used by `AgentSidebar`. Replace its direct state setter with a small setter that updates React state and writes the preference to `localStorage`.

Initialize the state lazily from that value in the browser, defaulting to closed when the preference does not exist or rendering on the server. This avoids accessing browser APIs during SSR and handles provider remounts (such as when the active conversation changes after a navigation) without losing the user's choice.

The storage key is scoped to the Vibe Garden Gardener panel and stores the
literal strings `true` or `false`. Invalid or missing values are treated as
closed.

## Error handling

If browser storage is unavailable or throws (for example, privacy-restricted browsing), the panel remains functional for the current page session; persistence is simply skipped.

## Verification

Add a focused component/provider test that proves the stored open preference is restored when the provider mounts, and that changing the state updates the stored preference. Run the focused test, the full test suite, typecheck, and production build.
