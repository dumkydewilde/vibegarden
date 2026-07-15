# Single-invite confirmation design

## Goal

Give an admin clear, persistent visual confirmation after a single email invite is successfully saved.

## Design

On a successful `invite` form action, the Admin page will show an inline success message immediately below the single-invite form. It will include a check icon and name the normalized email address that was invited, for example: `Invite sent for alice@example.com`.

The confirmation will use an `aria-live` region so assistive technology announces the result. It is displayed only for the single-invite action. Existing validation errors remain in place and bulk-invite feedback is unchanged.

## Data flow

The existing action returns a successful result extended with the invited email. The route component reads that result and conditionally renders the success message. No database or email-delivery behavior changes.

## Testing

Add a route-component test that supplies a successful single-invite action result and verifies the confirmation text is visible. Existing error and bulk-invite coverage remain unchanged.
