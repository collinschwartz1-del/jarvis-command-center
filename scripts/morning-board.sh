#!/usr/bin/env bash
# Always-on morning cycle: run a Jarvis /board pass, then sync the results into
# the command center so the dashboard is fresh when Collin wakes up.
#
# Enable it (runs every day at 7:00am) with:
#   (crontab -l 2>/dev/null; echo "0 7 * * * $HOME/Developer/jarvis-command-center/scripts/morning-board.sh >> /tmp/jarvis-board.log 2>&1") | crontab -
# Disable: crontab -e  and delete the line.
set -euo pipefail

# cron runs with a bare PATH — add where node/npm/claude actually live.
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

JARVIS_DIR="$HOME/Developer/jarvis-brain"   # moved off Desktop (macOS TCC blocked cron from Desktop). sync.mjs reads this via .env.local.
CC_DIR="$HOME/Developer/jarvis-command-center"

# 1. INTAKE: read Cowork's "CEO Daily Briefing TITAN" and stage approvable cards.
#    Credential-based (Gmail OAuth + Anthropic key) so it runs unattended — it
#    replaces the old `claude -p /board` pass, which couldn't auth its MCP
#    connectors under cron. Writes pending card .md into the brain; step 4 (sync)
#    mirrors them to the dashboard. Nothing executes until Collin approves a card.
cd "$CC_DIR"
node scripts/intake-cards.mjs || echo "card intake skipped (see log)"

# 2. Refresh command-center intel: inbox summaries + deal flags.
#    Headless + credential-based (no MCP) — see scripts/intel.mjs. The old
#    `claude -p` version failed silently under cron because the claude.ai
#    connectors (Gmail/M365/Supabase) only auth in an interactive session.
#    intel.mjs uses its own stored creds, so it actually runs at 7am.
#    Runs from the command-center dir (has .env.local + node_modules).
cd "$CC_DIR"
node scripts/intel.mjs || echo "intel refresh skipped (see log)"

# 3. Draft routine email replies (Sue review gate) — stages for the dashboard.
#    Reads the same 48h inbound mail, scope-gates to low-risk routine replies,
#    drafts in Collin's voice (multiple labeled options for yes/no & either/or
#    threads), runs the Sue review pass per option, and stages Sue-approved rows
#    as status 'pending' in email_drafts. Collin picks an option in the Jarvis
#    /replies tab; the dashboard stages the Gmail draft. Nothing auto-sends, and
#    this script never writes to Gmail itself. See scripts/draft-replies.mjs.
cd "$CC_DIR"
node scripts/draft-replies.mjs || echo "draft-replies skipped (see log)"

# 4. Mirror the files into Supabase for the dashboard.
cd "$CC_DIR"
npm run sync

# 5. Daily Opportunity Report — "source to cash" digest. Compiles revenue
#    opportunities from Lendr/LLS (money owed), email (deal_analyses +
#    email_briefs from step 2), texts (local Ollama — raw text stays on-Mac),
#    and the sue/trackers pipelines into ONE ranked report (closest-to-cash
#    first). Writes sue/trackers/opportunities/<date>.md and emails Collin a
#    digest (his own inbox only). Read-only: never sends to others or moves
#    money. NOTE: reading texts needs Full Disk Access on the cron process, and
#    Ollama must be running (`ollama serve`) — both degrade gracefully if absent.
cd "$CC_DIR"
node scripts/opportunity-report.mjs || echo "opportunity-report skipped (see log)"

# 6. Omaha Deal Engine — autonomous nightly refresh (one spine, every engine).
#    a) pull newly-qualified A/B/C leads from the Opportunity Engine brain → spine
#       (idempotent; dedups). b) auto-skip-trace untraced Tier A/B via BatchData,
#       bounded nightly spend (SKIPTRACE_NIGHTLY, default 250 ≈ $25/night; no-op if
#       BatchData balance is 0). c) text-intel local intake (Ollama; degrades if
#       absent). d) rebuild the brief from the live spine. All read creds from
#       deal-engine/.env. Lead alerts to Collin+Tyler stay OUT of cron until
#       ALERTS_LIVE=1 (then add the lead-alerts --send line).
DEAL_DIR="$HOME/Downloads/sue-build-v3/deal-engine"
if [ -d "$DEAL_DIR" ]; then
  node "$DEAL_DIR/bulk-ingest-from-oppengine.mjs"                       || echo "deal bulk-ingest skipped (see log)"
  node "$DEAL_DIR/skiptrace-batchdata.mjs" --tier AB --limit "${SKIPTRACE_NIGHTLY:-250}" || echo "deal skip-trace skipped (see log)"
  node "$DEAL_DIR/text-intel-intake.mjs"                                || echo "text-intel intake skipped (see log)"
  node "$DEAL_DIR/generate-brief.mjs"                                   || echo "deal-brief generate skipped (see log)"
  if [ "${ALERTS_LIVE:-0}" = "1" ]; then
    node "$CC_DIR/scripts/lead-alerts.mjs" --send                       || echo "lead-alerts skipped (see log)"
  fi
fi

echo "morning-board done: $(date)"
