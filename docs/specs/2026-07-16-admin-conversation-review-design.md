# Admin Conversation Review Design

## Goal

Let workshop administrators review participants' saved conversations with The
Gardener. The view is read-only and is intended to help the workshop host
understand where participants need more support.

Participants have already been informed through the workshop group chat, so
this feature adds no participant-facing notice.

## Scope

- Show non-empty Gardener conversations in the existing `/admin` page.
- Group each conversation with its participant and include its title, message
  count, and most recent activity time.
- Provide a link to an admin-only, read-only transcript at
  `/admin/conversations/:id`.
- Render transcript messages with the existing `ChatMessageBubble` component,
  preserving message context and saved Mermaid diagrams.
- Keep the existing participant conversation route unchanged.

## Access and Data Flow

Both the admin page and the transcript route call `requireAdmin` in their
server loaders before reading chat data. The transcript lookup is intentionally
separate from the participant-owned `getThread` helper: it locates a thread by
ID only after authorization, then returns its owning participant and messages.
Unknown thread IDs return a 404.

A server-side query lists only threads that have at least one message, joins
their owners, counts their messages, and orders them by most-recent activity.
The loader serializes only the fields needed for the review UI.

## UI

The `/admin` page receives a "Gardener conversations" card after the
participant overview. Each row shows the participant name (and email when a
name is available), conversation title, message count, and a date. The row
links to the transcript. If no conversations exist, the card states that there
are none to review.

The transcript page has a back link to Admin, participant attribution, the
conversation title, and the chronological message list. It includes no draft
field or actions to continue, alter, export, or plant the conversation.

## Errors and Testing

- Non-admin requests are rejected by the existing `requireAdmin` guard.
- A missing transcript returns 404.
- Empty threads do not appear in the admin listing.
- Tests cover the server query's shape and ordering plus the admin-list UI and
  its link to the read-only transcript.

## Non-goals

- Exporting, searching, editing, deleting, or annotating conversations.
- Changes to chat persistence, message data, participant-facing views, or
  workshop disclosure copy.
