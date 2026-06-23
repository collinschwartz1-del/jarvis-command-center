#!/usr/bin/env bash
# PGO dashboard cron wrapper. Mirrors lls-cron.sh. Creds come from .env.local
# (loaded by the .mjs scripts).
#
# Installed crontab lines:
#   0  7  * * *   .../scripts/pgo-cron.sh sync   >> /tmp/pgo-sync.log   2>&1   # daily 7am (Buildium loads same-day)
#   30 16 * * 5   .../scripts/pgo-cron.sh report >> /tmp/pgo-report.log 2>&1   # Friday 4:30pm
set -euo pipefail

# cron runs with a bare PATH — add where node/npm actually live.
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$HOME/Developer/jarvis-command-center"

case "${1:-sync}" in
  sync)   node scripts/pgo-sync.mjs ;;
  report) node scripts/pgo-weekly-report.mjs ;;
  *) echo "usage: pgo-cron.sh sync|report"; exit 1 ;;
esac
echo "pgo-cron ${1:-sync} done: $(date)"
