#!/usr/bin/env bash
# LLS dashboard cron wrapper. Mirrors morning-board.sh's env handling so the
# scheduled run matches a manual `npm run lls-sync`. Creds come from .env.local
# (loaded by the .mjs scripts), same as intel.mjs.
#
# Installed crontab lines:
#   0  *  * * *  .../scripts/lls-cron.sh sync   >> /tmp/lls-sync.log   2>&1   # hourly
#   30 6  1 * *  .../scripts/lls-cron.sh report  >> /tmp/lls-report.log 2>&1   # 1st of month
set -euo pipefail

# cron runs with a bare PATH — add where node/npm actually live.
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$HOME/Developer/jarvis-command-center"

case "${1:-sync}" in
  sync)   node scripts/lls-sync.mjs ;;
  report) node scripts/lls-monthly-report.mjs ;;
  *) echo "usage: lls-cron.sh sync|report"; exit 1 ;;
esac
echo "lls-cron ${1:-sync} done: $(date)"
