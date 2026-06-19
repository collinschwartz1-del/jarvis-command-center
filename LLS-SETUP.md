# LLS Lending Dashboard — setup

The `/lending` page (nav: **LLS**) pulls live Liquid Lending Solutions data from Lendr + your
Gmail. Data flows: `scripts/lls-sync.mjs` → Supabase (`lls_*` tables) → the page reads them.
Replies are drafted into Gmail (never auto-sent) and optionally mirrored to the loan's Lendr comments.

## 1. Apply the schema
Run `supabase/migrations/0002_lls.sql` against the project (Supabase SQL editor or `supabase db push`).
Creates: `lls_snapshot`, `lls_loans`, `lls_loan_comments`, `lls_inbox`, `lls_reports`.

## 2. Env vars in `.env.local`
Already set: `LENDR_API_BASE=https://joinlendr.com/api/v1`, `LENDR_API_KEY`, plus Supabase + Anthropic.
Still to add for the monthly report + (optionally) tune mail scanning:
```
GDRIVE_LLS_FOLDER_ID=<Drive folder id for the report PDFs>
LLS_MAIL_DAYS=7        # optional, default 7
```

> **API confirmed live (2026-06-18).** Base `https://joinlendr.com/api/v1`, Bearer auth, responses
> wrapped as `{success, data, summary}`. The REST API exposes raw resources (`/loans`, `/investors`,
> `/payments`, `/loans/:id/comments`) — there is **no** aggregated `dashboard-stats` route, so
> `lls-sync.mjs` **computes** the fund snapshot from that raw data (verified to match the old MCP
> figures to the cent: available $5.56M, outstanding $25.38M, total $30.93M, concentration, and
> $337K gross monthly interest). Loan comments POST `{ comment }` (confirmed against the Lendr API
> schema). Gmail reply-drafting and Drive scopes are authorized and tested.

## 3. Re-authorize Google (one time)
The reply-draft and report-to-Drive features need broader scopes than the original read-only token.
`scripts/gmail-auth.mjs` now requests `gmail.readonly` + `gmail.compose` + `drive.file`:
```
npm run gmail-auth        # click Allow, paste the new GMAIL_REFRESH_TOKEN into .env.local
```

## 4. Populate + view
```
npm run lls-sync          # pulls Lendr snapshot, loans, comments, and classifies LLS mail
npm run dev               # open http://localhost:3000/lending
```
Sanity-check the tiles against known-good live values (captured 2026-06-18):
Capital Available **$5.56M**, Deployed **$25.38M**, Total Fund **$30.93M**,
Active **78**, Pipeline **13 loans / $5.93M**, Past-Maturity **51 / $17.2M**,
Monthly Interest **~$337K**.

> The **Borrower Inbox and reply** features need Gmail, which is not configured in `.env.local` yet.
> Run `npm run gmail-auth` (step 3) to add `GMAIL_REFRESH_TOKEN`; until then the sync still pulls all
> Lendr data and the inbox section is simply empty.

## 5. Monthly report
```
npm run lls-report                 # prior month → Obsidian note + Drive PDF + lls_reports row
node scripts/lls-monthly-report.mjs 2026-05    # backfill a specific month
```
Writes two artifacts (independent — the note is written even if the PDF step fails):
- **Obsidian note** → `06-Finance/LLS Reports/<period> - LLS Financial Health.md` (Dataview frontmatter
  + tables). Override the folder with `LLS_VAULT_DIR` in `.env.local`.
- **Drive PDF** → the `GDRIVE_LLS_FOLDER_ID` folder (or My Drive root if unset).

> **Drive PDF needs the Drive API enabled** for the Google Cloud project. The OAuth `drive.file`
> scope is granted, but the API itself must be turned on once at
> `https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=592531678463`
> → Enable. Until then the Obsidian note still writes; the PDF link is just null.

## 6. Cron (alongside the existing `intel` job)
```
*/60 *  * * *  cd <repo> && npm run lls-sync   >> /tmp/lls-sync.log 2>&1   # hourly
0    6  1 * *  cd <repo> && npm run lls-report  >> /tmp/lls-report.log 2>&1 # 1st of month
```

## Notes / guardrails
- **No auto-send, no money movement.** Replies are saved as Gmail drafts on the thread; you send
  from Gmail. Mirroring to Lendr posts a comment only.
- **Email→loan matching** is heuristic (property-address tokens, then borrower last name). Unmatched
  mail still appears in the inbox, just without a loan badge or carried-through comments.
- LLS-team mail (`@liquidlendingsolutions.com`, i.e. Luke / Angie) and borrower-request / draw items
  are pinned to the top of the Borrower Inbox via `priority`.
