#!/usr/bin/env bash
# Push the three Gmail OAuth vars from .env.local into the linked Vercel project
# (production), without ever printing the secret values. Idempotent: removes any
# existing value first so re-runs don't error on "already exists".
#
# Prereqs: `vercel login` done, and .vercel/project.json present (already linked).
# Run from the project root:  bash scripts/set-vercel-gmail-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.local ] || { echo "no .env.local found"; exit 1; }

for VAR in GMAIL_CLIENT_ID GMAIL_CLIENT_SECRET GMAIL_REFRESH_TOKEN; do
  # Pull the value straight from .env.local (everything after the first '=').
  VAL="$(grep -m1 "^${VAR}=" .env.local | cut -d= -f2- | sed 's/[[:space:]]*$//')"
  if [ -z "$VAL" ]; then
    echo "  ✗ ${VAR}: not found in .env.local — skipping"
    continue
  fi
  # Remove any existing prod value (ignore errors if absent), then add fresh.
  vercel env rm "$VAR" production --yes >/dev/null 2>&1 || true
  printf '%s' "$VAL" | vercel env add "$VAR" production >/dev/null 2>&1
  echo "  ✓ ${VAR}: set on Vercel production"
done

echo "Done. Redeploy (or merge the PR) for the new env vars to take effect."
