#!/usr/bin/env bash
# First-time deploy for Vibe Garden. Requires `wrangler login` first.
# Safe to re-run: every step is idempotent or skips itself.
set -euo pipefail
cd "$(dirname "$0")/.."

PLACEHOLDER="00000000-0000-0000-0000-000000000000"

echo "==> Checking wrangler auth"
npx wrangler whoami >/dev/null

if grep -q "$PLACEHOLDER" wrangler.jsonc; then
  echo "==> Creating D1 database 'vibe-garden'"
  OUTPUT=$(npx wrangler d1 create vibe-garden 2>&1) || {
    echo "$OUTPUT"
    # Already exists? Look its id up instead.
    OUTPUT=$(npx wrangler d1 info vibe-garden 2>&1)
  }
  DB_ID=$(echo "$OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$DB_ID" ]; then
    echo "Could not find the database id in wrangler output:" && echo "$OUTPUT" && exit 1
  fi
  echo "==> Writing database_id $DB_ID into wrangler.jsonc"
  sed -i '' "s/$PLACEHOLDER/$DB_ID/" wrangler.jsonc
else
  echo "==> wrangler.jsonc already has a database id, skipping create"
fi

echo "==> Applying migrations to the remote database"
npx wrangler d1 migrations apply DB --remote

echo "==> Setting secrets"
# Fresh random session secret for production (not the dev one).
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET

# Pull the service keys from .dev.vars so they are typed in exactly once.
get_var() { grep "^$1=" .dev.vars | head -1 | cut -d= -f2- | tr -d '"'; }

for key in OPENROUTER_API_KEY RESEND_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  value=$(get_var "$key" || true)
  if [ -n "$value" ]; then
    echo "   - $key"
    printf '%s' "$value" | npx wrangler secret put "$key"
  else
    echo "   - $key not in .dev.vars, skipping"
  fi
done

echo "==> Deploying"
npm run deploy

echo ""
echo "Done. Log in with your ADMIN_EMAIL at the workers.dev URL above."
echo "Reminders:"
echo "  - Resend's onboarding@resend.dev sender only delivers to your own"
echo "    address; verify a domain in Resend before inviting friends."
echo "  - For Google login, add <your-url>/auth/google/callback as an"
echo "    authorized redirect URI in Google Cloud Console."
