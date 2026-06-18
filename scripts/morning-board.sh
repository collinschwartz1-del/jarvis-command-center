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

# 2. Refresh command-center intel: inbox summaries + deal flags.
#    Headless + credential-based (no MCP) — see scripts/intel.mjs. The old
#    `claude -p` version failed silently under cron because the claude.ai
#    connectors (Gmail/M365/Supabase) only auth in an interactive session.
#    intel.mjs uses its own stored creds, so it actually runs at 7am.
#    Runs from the command-center dir (has .env.local + node_modules).
cd "$CC_DIR"
node scripts/intel.mjs || echo "intel refresh skipped (see log)"

# 3. Mirror the files into Supabase for the dashboard.
cd "$CC_DIR"
npm run sync

echo "morning-board done: $(date)"
