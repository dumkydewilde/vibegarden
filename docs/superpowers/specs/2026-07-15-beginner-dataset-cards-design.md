# Beginner dataset cards design

## Goal

Turn “Datasets to start from” into a set of actionable beginner starting points. A participant should be able to understand what a source offers, read approachable documentation, or begin a grounded conversation with the Gardener without first learning what an API, export, or context window is.

This design supersedes the interaction and metadata parts of `2026-07-14-inspiration-datasets-design.md`. The balanced twelve-source curation target remains.

## Beginner source criteria

Re-audit all twelve sources and prefer sources with:

- interactive or plain-language documentation;
- no API key, payment method, or developer-account setup;
- direct JSON, CSV, XLSX, GeoJSON, or documented personal export access;
- bounded requests or downloads that are practical for a workshop;
- obvious project ideas that can be described without domain expertise; and
- stable, official URLs.

Personal exports may require an account with the service because the participant is retrieving their own data. Large bulk dumps may still be linked when a smaller API request, filtered export, or sample URL is also available.

Open-Meteo replaces KNMI as the weather source. It offers no-key JSON, CSV, and XLSX access, interactive documentation, forecasts, and historical weather. The other eleven sources are retained only if the research pass finds a similarly usable beginner path; otherwise they should be replaced while preserving the approved balance of local/civic, personal, and global culture/technology data.

## Dataset metadata

Dataset cards use a dedicated item type rather than the general inspiration-item shape. Each item contains:

- `title`: short source name;
- `description`: the participant-facing project pitch;
- `tag`: `Open data` or `Personal data`;
- `docsUrl`: destination for “Read the docs”;
- `homepageUrl`, when distinct and useful;
- `formats`: short visible labels such as `JSON`, `CSV`, or `GeoJSON`;
- `access`: a short visible label such as `No API key` or `Account export`;
- `availableData`: a concise list of what the participant can retrieve;
- `sampleUrls`: zero or more bounded, public data responses with a label and format; and
- `starterPrompt`: the question sent when starting with the Gardener.

The Gardener context is generated from this metadata in a consistent text format. It includes the source title, description, access route, formats, documentation, available information, sample URLs, and the explicit instruction that personal data must not be fetched unless the participant supplies it.

## Card interaction

Dataset cards are no longer whole-card links. Their footer contains two explicit actions:

1. **Ask Gardener** — the primary action, using the existing sprout visual language.
2. **Read the docs** — a secondary external link that opens `docsUrl` in a new tab.

Compact badges make format and access requirements visible before either action. Keep the cards concise: the complete field list and sample URLs belong in Gardener context, not in the visible description.

“Ask Gardener” does two things as one action: it begins a fresh conversation with the item’s `starterPrompt`, and it attaches the dataset metadata to that sent message. The participant does not need a separate “Add to context” button in this version because the primary action already adds the context.

## Gardener context flow

Extend Gardener context with a `dataset` kind and a database icon. Extend `askFresh` to accept optional context items while preserving existing callers.

The operation order is important:

1. reset the visible conversation and local message reference;
2. set the dataset on the context reference synchronously;
3. open the Gardener panel;
4. create the fresh server-side thread;
5. send the starter prompt through the existing `ask` path; and
6. clear pending context after it has been copied onto the sent user message.

The existing message rendering places the context card above the participant’s message. That visible “Open-Meteo weather” attachment is the confirmation that the Gardener received the dataset information. It remains visible in conversation history.

## Tool boundary and future analysis

PR #3 supplies `fetch_page`, which can retrieve readable documentation and bounded raw JSON or CSV responses as text. The Gardener may use the supplied documentation and sample URLs to explain fields, show what a response contains, and propose projects.

PR #3 does not yet supply the planned DuckDB-WASM analysis loop. The cards must not claim that the Gardener has analyzed a dataset merely because it can fetch a response. Structured `sampleUrls`, `formats`, and `availableData` metadata provide the handoff for DuckDB-WASM later without another card-model redesign.

This work does not merge PR #3 into the current branch. It uses the existing Gardener context interface and remains compatible with PR #3’s additive provider and tool changes.

## Errors and privacy

- Documentation remains usable if the Gardener or model provider is unavailable.
- A failed Gardener response retains the sent dataset context card, making the attempted input inspectable and retryable.
- Fetchable sample URLs must be bounded enough for the tool’s response limit and must not contain secrets or participant-specific identifiers.
- Personal-data cards link to official export instructions and never include a participant’s data in static metadata.
- Source access requirements are stated honestly; a source requiring registration must not carry a `No API key` badge.

## Verification

Automated tests cover:

- format and access badges plus the two expected actions on dataset cards;
- “Read the docs” destinations and external-link attributes;
- the Open-Meteo replacement and twelve-card total;
- `dataset` context rendering;
- fresh-conversation startup with a dataset context snapshot attached to the sent message;
- unchanged behavior for existing `askFresh(question)` callers; and
- all current inspiration and Gardener tests.

Run the full typecheck and test suite. Review the authenticated `/inspiration` route at desktop and mobile widths when a browser session is available, checking card height, action wrapping, panel opening, and the visible dataset attachment in the conversation.
