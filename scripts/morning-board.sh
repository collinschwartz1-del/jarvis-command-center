#!/usr/bin/env bash
# Always-on morning cycle: run a Jarvis /board pass, then sync the results into
# the command center so the dashboard is fresh when Collin wakes up.
#
# Enable it (runs every day at 7:00am) with:
#   (crontab -l 2>/dev/null; echo "0 7 * * * $HOME/Desktop/jarvis-command-center/scripts/morning-board.sh >> /tmp/jarvis-board.log 2>&1") | crontab -
# Disable: crontab -e  and delete the line.
set -euo pipefail

# cron runs with a bare PATH — add where node/npm/claude actually live.
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

JARVIS_DIR="$HOME/Desktop/jarvis"
CC_DIR="$HOME/Desktop/jarvis-command-center"

# 1. Run a Board pass headlessly (requires the `claude` CLI, logged in).
cd "$JARVIS_DIR"
claude -p "/board" || echo "board pass failed — continuing"

# 2. Refresh command-center intel: inbox summaries + deal underwriting.
#    Runs in the Jarvis project, which has Gmail, M365, and Supabase MCP access.
cd "$JARVIS_DIR"
claude -p "Refresh the Jarvis command center (Supabase project hxastxplmyowqmaypqip), read-only on email, never send anything:
1. Pull the last 48h of inbox from BOTH Gmail and Microsoft 365. Summarize by person — one row per sender with a short summary, key takeaways, and any action items. Upsert into the 'email_briefs' table (unique on person_email; skip pure marketing/noise).
2. For deal emails: if multifamily and a T-12, rent roll, or OM is attached, run the LW underwriting skill in jarvis/context (Deal Review + Preliminary LW Fit Score) and upsert into 'deal_analyses'. If single-family / likely flip, record a Flip Tracker hand-off row (asset_type 'flip', routed_to 'flip-tracker', price + address). Screen on available data and flag missing docs when financials are not attached.
3. Promote any deal needing a human underwrite into a card in jarvis/cards/ routed to the underwriter seat.
Flag any wire / new-payment-instruction email for phone verification; never act on money movement." || echo "intel refresh skipped"

# 3. Mirror the files into Supabase for the dashboard.
cd "$CC_DIR"
npm run sync

echo "morning-board done: $(date)"
