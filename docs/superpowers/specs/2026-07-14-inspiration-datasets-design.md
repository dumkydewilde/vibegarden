# Inspiration dataset curation design

## Goal

Expand the “Datasets to start from” section from five cards to a tightly curated set of twelve for socially active, tech-interested people in their thirties. The list should make readers want to build something, not read like a generic open-data directory.

## Curation approach

Use a balanced mix of:

- local and civic data with an Amsterdam or Netherlands connection;
- personal-data exports that reveal patterns in someone’s own life; and
- global culture, community, mobility, sustainability, and technology data.

Retain the five existing subjects when an active, useful source can be verified. Add seven complementary datasets. Prefer variety over several sources that invite essentially the same project.

## Dataset requirements

Every card must:

- link to an official dataset, download page, data portal, or documented export route;
- be active and accessible without a paid enterprise account;
- offer actual reusable data rather than only an article or finished visualization;
- have a short description that suggests one or more concrete projects;
- use the existing `Open data` or `Personal data` tag where appropriate; and
- open through the existing external-link card behavior.

Primary sources are preferred. A reputable community source is acceptable only when it is the canonical home of the dataset.

## Content shape

Keep the existing card layout and `InspirationItem` model unchanged. Update only the `datasets` array in `app/routes/inspiration.tsx` unless verification exposes a small accessibility or interaction issue directly related to the new links.

The final twelve should feel balanced across the three curation groups, with enough topical range to support maps, recommenders, personal dashboards, social tools, cultural explorations, and public-interest projects.

## Verification

Verify each destination against its current official page, check that it describes access to or export of the promised data, and run the project’s typecheck and relevant tests after editing. Review the rendered section if a local browser is readily available, paying particular attention to card wrapping and the twelve-item grid.
