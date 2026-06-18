# Headless Intel Setup — make the 7am run actually read your mail

## The problem this fixes
The old morning cron called `claude -p "Refresh..."` and asked it to read Gmail/
M365/Supabase **through the claude.ai connectors**. Those only authenticate in an
*interactive* session — under cron they return "permission not granted," so the
inbox-summary + deal-flagging step silently did nothing every morning.

## The fix (already built)
`scripts/intel.mjs` replaces that step. It talks to Gmail, M365, Supabase, and
Claude with **its own stored credentials** (plain HTTPS, no MCP), so it runs fine
headless. The board pass and dashboard sync were never affected. If credentials
are missing it logs and exits cleanly — the cron never breaks.

**Status:** code done, wired into `morning-board.sh`, syntax-checked, dry-run
passes. The only thing left is to give it Gmail read access (one-time).

---

## What YOU do once — Gmail read access (~10 min)
You already have a Google Cloud project from the Places API work; reuse it.

1. **Enable the Gmail API:** Google Cloud Console → APIs & Services → Library →
   search "Gmail API" → **Enable**.
2. **Create the OAuth client:** APIs & Services → Credentials → **Create
   Credentials → OAuth client ID** → Application type **Desktop app** → Create.
   (If it asks you to configure a consent screen first: pick **External**, add
   your email as a test user, scope `gmail.readonly`.)
3. **Copy the client ID + secret** into `.env.local`:
   ```
   GMAIL_CLIENT_ID=...apps.googleusercontent.com
   GMAIL_CLIENT_SECRET=...
   ```
4. **Mint the refresh token — no manual code copying:**
   ```
   cd ~/Desktop/jarvis-command-center && npm run gmail-auth
   ```
   A browser opens → click **Allow** → it writes `GMAIL_REFRESH_TOKEN` straight
   into `.env.local` (the token is never printed to the terminal).
5. **Test it:**
   ```
   npm run intel
   ```
   You should see "pulled N Gmail messages" and "N briefs, N deals upserted."

That's it — tomorrow's 7am run will populate `email_briefs` and `deal_analyses`.

## Microsoft 365 (optional, later)
Only needed if you want your LeavenWealth/Outlook mail in the brief too. Requires
an Azure app registration with **Mail.Read** *application* permission + admin
consent, then fill `MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_USER`.
Until then intel.mjs just skips M365 — Gmail alone is enough to make the run real.

## What it does each morning
- Pulls last 48h of mail, groups by sender, writes one decision-grade row per
  person to `email_briefs` (skips marketing/noise).
- Flags real-estate deal emails into `deal_analyses` (multifamily → underwriter,
  SFH/flip → flip-tracker), noting whether financials were attached.
- Flags any wire / changed-payment-instruction email with a **WIRE-VERIFY** action
  item. It never sends, replies, or moves money — read + summarize only.
