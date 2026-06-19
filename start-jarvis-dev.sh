#!/bin/bash
# Always-on Jarvis dev server launcher (managed by launchd: com.collinschwartz.jarvis-server)
# Keeps `next dev` running on :3000, auto-restarted by launchd if it exits.
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd /Users/collinschweattz/Developer/jarvis-command-center || exit 1
exec npx next dev -p 3000
