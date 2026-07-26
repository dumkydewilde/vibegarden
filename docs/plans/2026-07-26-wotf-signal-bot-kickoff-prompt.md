# WOTF Signal bot: kickoff prompt for the new repo

Decision (see conversation, 2026-07-26): the WOTF philosophy bot is a
separate project, not part of Vibe Garden. The runtimes are incompatible
(long-running signal-cli daemon in Docker on the old MacBook vs stateless
Cloudflare Worker) and the data (private group chat history) does not belong
in a shared learning repo. It reuses `packages/agent-core` from this repo,
which is runtime-neutral by design.

Prep before running the prompt in the new repo:

1. Create the empty repo and copy `packages/agent-core` from
   `~/code/vibegarden` into it at the same path.
2. Paste the prompt below into a fresh Claude Code session there.

---

# WOTF Signal Bot — project kickoff

Build a Signal group-chat bot for WOTF, my philosophy friends group. It runs
24/7 in Docker on an old MacBook. It should answer direct questions, chime in
voluntarily (sparingly!) when it can genuinely add philosophical value, ground
its answers in the Stanford Encyclopedia of Philosophy, and remember the
group's message history. One special rule: my friend Gert gets an instant,
mildly smug reply to every message he sends. That's the joke, protect it.

## Stack and architecture

- **TypeScript on Node 22**, plain long-running process (no framework), Vitest
  for tests, ESM throughout.
- **Signal transport:** use the `bbernhard/signal-cli-rest-api` Docker image in
  `MODE=json-rpc`. The bot receives messages by subscribing to its websocket
  (`/v1/receive/{number}`) and sends via `POST /v2/send`. Wrap this in a
  `SignalTransport` interface (`onMessage(handler)`, `send(groupId, text,
  quoteTimestamp?)`) so tests can use an in-memory fake. Do not talk to
  signal-cli directly anywhere else in the codebase.
- **LLM:** OpenRouter (OpenAI-compatible chat completions).
  `packages/agent-core` in this repo (copied from another project of mine)
  already implements the streaming turn loop, tool rounds, and ToolSpec
  types against an OpenAI-compatible endpoint; build on it rather than
  reimplementing. If the package is missing, write a minimal equivalent:
  one function that runs a system prompt + history + tools through chat
  completions with up to N tool rounds and returns the final text.
- **Storage:** SQLite via `better-sqlite3`, one file in a mounted volume.
  Tables: `messages` (timestamp, sender_uuid, sender_name, group_id, text,
  is_bot) with an FTS5 index for search, and `sep_cache` (url, title, text,
  fetched_at). Log every incoming group message and every bot reply.
- **Config:** `.env` file, validated loudly at startup: `OPENROUTER_API_KEY`,
  `MODEL` (default something strong), `GATE_MODEL` (default something cheap
  and fast), `SIGNAL_API_URL`, `BOT_NUMBER`, `WOTF_GROUP_ID`, `GERT_UUID`,
  `DB_PATH`.

## Behavior

There are three reply paths, checked in this order for every incoming
group message (never react to the bot's own messages, and ignore
receipts/typing/reactions):

1. **Gert rule.** If `sender_uuid == GERT_UUID`, always reply, immediately,
   quoting his message. Tone: a philosophy professor who has seen this
   argument before, praising with faint damns. Warm underneath, never
   actually mean, one to three sentences, no lecture. This path skips the
   gate but still uses SEP/history tools if useful.
2. **Direct address.** If the bot is @-mentioned, quoted-replied, or the
   message plausibly asks the bot something, run a full answer turn.
3. **Voluntary chime-in.** Otherwise, run a cheap gate first: send the last
   ~10 messages to `GATE_MODEL` asking for a JSON verdict, "would a short,
   genuinely valuable philosophical contribution improve this conversation
   right now?" with a bias toward NO. Only on yes, run a full turn. Hard
   limits regardless of the gate: at most 1 voluntary reply per 30 minutes
   and 6 per day, and never twice in a row without a human message between.

The full answer turn gets these tools:

- `search_sep(query)` and `read_sep(url)`: search the Stanford Encyclopedia
  of Philosophy (plato.stanford.edu, use its search endpoint or a
  site-scoped search), fetch article HTML, strip to readable text, cache in
  `sep_cache`. Answers that draw on SEP should name the entry ("SEP's entry
  on compatibilism...") rather than dumping links.
- `search_history(query, limit)`: FTS5 search over the group's logged
  messages, returning sender, date, and text, so the bot can say "you argued
  the opposite in March."

## Persona

System prompt lives in `prompts/system.md` as plain markdown with
`{{RECENT_MESSAGES}}`, `{{SENDER}}`, `{{MODE}}` (gert | direct | voluntary)
placeholders filled at runtime, so I can edit the personality without
touching code. Write a first draft: erudite but conversational, speaks
Dutch or English matching the message it replies to, keeps group replies
under ~120 words, quotes philosophers accurately or not at all, and in
gert mode adds the smugness. Also create `prompts/gert-flavor.md` appended
only in gert mode, so the joke is tunable separately.

## Docker

`docker-compose.yml` with two services: `signal-api`
(bbernhard/signal-cli-rest-api, volume for `/home/.local/share/signal-cli`)
and `bot` (built from a small node:22-alpine Dockerfile, volume for the
SQLite file, `restart: unless-stopped`, depends_on signal-api). README
documents the one-time setup: registering a dedicated number (or linking
as secondary device via the QR endpoint), finding the group id via
`GET /v1/groups`, and getting Gert's UUID from a logged message.

## Milestones — build and verify in this order, committing after each

1. Echo skeleton: transport + config + compose; bot logs messages and
   replies "pong" to "ping" in the group.
2. Direct answers: agent-core turn wired up with persona, no tools yet.
3. Memory: SQLite logging + `search_history` tool.
4. SEP: both SEP tools with cache.
5. Voluntary gate + rate limits + the Gert rule, with unit tests for the
   policy layer (the order, the limits, the never-reply-to-self rule).

Write tests against the fake transport for the policy layer especially.
Start with milestone 1 and show me it running before moving on.
