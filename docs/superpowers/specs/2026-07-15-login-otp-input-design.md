# Login OTP input design

## Goal

Prevent browser autofill from placing the login email address in the verification-code field, while providing a clear, accessible six-digit OTP entry experience.

## Design

Replace the plain text code input on the login verification step with the shadcn-style `InputOTP` composition backed by the `input-otp` package. It will render two groups of three digit slots separated by a visual divider, accept only six numeric digits, support pasting a complete code, and retain `autocomplete="one-time-code"`.

The OTP component will be controlled by local React state and render one form control named `code` containing the entered digits. The requested email remains only in the existing hidden `email` field, so it is submitted for server-side verification without being assigned to the visible OTP control. The existing request, resend, error, expiry, and successful-login paths are unchanged.

## Components and dependencies

Add the `input-otp` package and a reusable `app/components/ui/input-otp.tsx` component following the project's existing UI component conventions. Update `app/routes/login.tsx` to use it for the code step; no database, action, or API changes are needed.

## Accessibility and errors

The visible entry has a clear verification-code label, numeric input mode, and browser one-time-code autocomplete. When verification fails, it receives `aria-invalid` and continues to display the existing explanatory error. Disabled state follows the current form submission state.

## Testing

Add route-level coverage showing that the OTP entry is blank when the code step first appears, accepts a six-digit value, and presents the existing failure message when the action returns an error. Existing login behavior remains covered by the full test suite and TypeScript check.
