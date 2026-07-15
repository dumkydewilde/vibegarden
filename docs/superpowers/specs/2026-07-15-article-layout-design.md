# Article layout adjustment

## Goal

Make long-form Learning articles and Building Block pages modestly wider and visually centered in the available application canvas when the persistent left navigation is visible.

## Scope

- Apply one shared desktop article-page container style to both route types.
- Increase the content width from `70ch` to `78ch`.
- Remove the fixed desktop left padding that currently offsets the centered column.
- Preserve the existing mobile width and page padding supplied by `AppShell`.

## Design

The shared style will center a `78ch` content column with automatic horizontal margins. It will be defined in the application stylesheet and used by the Learning article and Building Block page route containers. This avoids duplicated sizing rules and makes both content types behave identically as the available main area changes because of the left navigation or the optional Gardener sidebar.

## Non-goals

- Changing the size, position, or responsive behavior of either sidebar.
- Changing article typography, MDX rendering, comments, or controls.
- Changing mobile layout spacing.

## Verification

- Add focused route-rendering assertions for the shared layout class.
- Run the targeted test suite, then the repository's full test and build commands.
- Inspect a desktop rendering with the left navigation present to confirm the column is wider and centered.
