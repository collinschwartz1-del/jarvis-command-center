# Jarvis Command Center — System Map

_Last updated: 2026-06-19. How everything connects: data flows, tools, redundancies, and the security model. This is the canonical reference before scaling the system._

> **Live code lives at `~/Developer/jarvis-command-center`.** (`~/Desktop/jarvis-command-center` was a symlink that is now a gutted stub — ignore it.) **The file-based "brain" data (cards, briefings, state — NOT the web app) lives at `~/Developer/jarvis-brain/jarvis/`** — relocated from `~/Desktop/jarvis` on 2026-06-20 because macOS TCC blocked cron/launchd from running anything under Desktop (`EPERM uv_cwd`, which silently broke the morning pass).

---

## 1. What this is

A Next.js 15 + Supabase dashboard that pulls Collin's operations into one cockpit:
**cards/decisions, email (inbox + drafted replies), LLS lending, deals/underwriting, local text intel, an Ask-Jarvis chat, plus agents & a SUE handoff bridge.**

- **Frontend/Backend:** Next.js (app router), server actions, API routes (Node runtime).
- **Database / source of truth:** Supabase Postgres.
- **Deploy:** Vercel (`jarvis-command-center-eta.vercel.app`) + an always-on local `next dev` (launchd `com.collinschwartz.jarvis-server`).
- **Local-only features:** Texts intel (iMessage stays on the Mac; Ollama classifies on-device).

---

## 2. The daily cycle (how data gets in)

```
6:30am  launchd com.collin.text-intel.daily   → iMessage → Ollama → ~/text-intel-vault/intel/cards.json
7:00am  morning-board.sh (crontab — SINGLE runner; the launchd jarvis-board job was retired 2026-06-20)
          1. intake-cards.mjs  Gmail → reads Cowork "CEO Daily Briefing TITAN" → stages pending card .md
                               (replaced the `claude -p /board` pass — agent MCP can't auth under cron)
          2. intel.mjs        Gmail/M365 → email_briefs + deal_analyses (deal flags)
          3. draft-replies.mjs Gmail → email_drafts (Sue-reviewed reply drafts)
          4. sync.mjs         ~/Developer/jarvis-brain .md files → cards, briefings, handoffs, metrics
          5. opportunity-report.mjs → "source-to-cash" digest (markdown + email to Collin)
hourly  lls-cron.sh sync → lls-sync.mjs   Lendr API + Gmail → lls_snapshot, lls_loans, lls_inbox, lls_loan_comments
1st/mo  lls-cron.sh report → lls-monthly-report.mjs → PDF to Drive + lls_reports row
```

Everything the dashboard shows is read from Supabase (except Texts, which reads the local vault file directly).

---

## 3. Tabs → data sources → actions

| Tab (route) | Reads | Writes / Actions |
|---|---|---|
| **Core** `/` | metrics, latest briefing, tier-3 pending cards, activity feed | approve/dismiss card |
| **Inbox** `/inbox` | `email_briefs` (per-person 48h summaries) | toggle action item done |
| **Replies** `/replies` | `email_drafts` (pending/held, with Sue's verdict + variants) | approve (→ Gmail **draft**, never sends), dismiss |
| **Lending** `/lending` | `lls_snapshot`, `lls_loans`, `lls_inbox`, `lls_loan_comments`, `lls_reports` | reply to borrower (Gmail draft ± Lendr comment), mark handled |
| **Sales** `/sales` `/sales/[id]` | `deals`, `deal_analyses` | run underwriting (`/api/analyze`), route to Flip Tracker |
| **Projects** `/projects` | `cards` grouped by status | approve/dismiss card (also rewrites source .md, best-effort) |
| **Agents** `/agents` | `agents` (seats, last run/summary) | read-only |
| **Bridge** `/bridge` | `handoffs` (Jarvis↔SUE) | read-only (status is file-driven) |
| **Texts** `/texts` | local `~/text-intel-vault/intel/cards.json` | Classify Now (`/api/text-intel/classify`, localhost-only), copy reply, dismiss |
| **Ask** `/ask` | live cards/brief/deals/handoffs/agents + web search | chat only (advises; doesn't execute) |

**All mutations:** gated by `requireOwner()`, logged to `activity`, then `revalidatePath`.

---

## 4. Supabase tables & their consumers

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `cards` | unit-of-work decisions | sync.mjs, approve/dismiss actions | Core, Projects, Ask |
| `briefings` | daily brief markdown | sync.mjs | Core, Ask |
| `metrics` | daily tiles | sync.mjs | Core |
| `activity` | event log | every write action | Core feed |
| `agents` | board seats | manual | Agents, Ask |
| `handoffs` | SUE bridge queue | sync.mjs (file-based) | Bridge, Ask |
| `email_briefs` | per-person mail summary | intel.mjs | Inbox, Ask |
| `email_drafts` | reply drafts + Sue verdict | draft-replies.mjs, approveReply | Replies |
| `deals` | pipeline rows | manual (light use) | Sales, Ask |
| `deal_analyses` | LW underwriting (fit score, flags) | intel.mjs, /api/analyze, routeToFlipTracker | Sales |
| `lls_snapshot` | fund snapshot time-series | lls-sync.mjs | Lending |
| `lls_loans` | active + pipeline loans | lls-sync.mjs | Lending |
| `lls_inbox` | borrower-request mail | lls-sync.mjs, reply/markHandled | Lending |
| `lls_loan_comments` | Lendr team comments | lls-sync.mjs, replyToLlsEmail | Lending |
| `lls_reports` | monthly PDF metadata | lls-monthly-report.mjs | Lending |
| `properties` / `portfolio_summary` | Folio portfolio financials | import-folio.mjs | _(not displayed yet)_ |

---

## 5. Tools & integrations

| Service | Used by | Purpose | R/W | Key |
|---|---|---|---|---|
| **Anthropic (Claude)** | /api/ask, /api/analyze, lib/underwrite, intel/draft-replies/lls-sync/opportunity scripts | chat (Opus 4.8 + web), underwriting, mail classification, drafting | → DB only | `ANTHROPIC_API_KEY` |
| **Supabase** | everything | system of record | R/W | url + anon (browser) + **service-role** (server) |
| **Gmail (OAuth)** | lib/gmail, intel, draft-replies, lls-sync, lls-report | read 48h mail; **draft** replies (compose scope, no send) | R/W (drafts) | `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` |
| **Lendr** | lib/lendr, lls-sync, lls-report, lending actions | loans/investors/comments; post loan comment | R/W (comments) | `LENDR_API_BASE/KEY` |
| **Google Drive** | lls-monthly-report | upload monthly PDF | W | (Gmail OAuth, drive.file) |
| **ElevenLabs** | /api/tts | voice output (falls back to browser TTS) | W | `ELEVENLABS_API_KEY/VOICE_ID` (optional) |
| **Ollama (local)** | text-intel pipeline, opportunity-report | on-device classification; raw text never leaves Mac | R | `OLLAMA_URL` (optional) |
| **M365 / Outlook** | intel.mjs | optional second mailbox | R | `MS_*` (optional, half-built) |

**Automation:** launchd — `com.collinschwartz.jarvis-server` (always-on dev), `com.collin.text-intel.daily` (6:30am). Cron — `morning-board.sh` (7:00am, the single board runner), `lls-cron.sh` hourly sync + monthly report. Logs in `/tmp/*.log` and `jarvis-dev.log`. _(The `com.collinschwartz.jarvis-board` launchd job — old `run-board.sh` intake — was retired 2026-06-20; its plist is renamed `.disabled`. Principle: automate via credential-based `.mjs`, not `claude -p` agent runs that can't auth MCP headlessly.)_

---

## 6. Redundancy & cleanup notes

**Not redundant (keep):**
- Three Supabase clients (`supabase.ts` admin / `supabase-server.ts` session / `supabase-browser.ts` login) — distinct security boundaries.
- `lls-monthly-report.mjs` vs `opportunity-report.mjs` — different cadence/audience (monthly statement vs daily acquisition list).
- `sync.mjs` / `lls-sync.mjs` / `intel.mjs` — different sources and tables.

**Low-value duplication (optional refactor):**
- Gmail fetch/parse helpers (`gmailToken`, header/body decode) are copy-pasted across `intel.mjs`, `draft-replies.mjs`, `lls-sync.mjs`, and `app/lending/actions.ts`. Extract to a shared `lib/gmail-fetch.mjs`. Low ROI (runs ~1×/day) but reduces drift.
- Cron setup instructions repeated across `LLS-SETUP.md` + `HEADLESS-INTEL-SETUP.md` — consider one `AUTOMATION.md`.

**Intentionally partial (not dead):** M365 mail, Flip Tracker routing, Folio import, `OPP_INCLUDE_LLS` gate — all degrade gracefully when their env/inputs are absent.

**To verify:** `properties`/`portfolio_summary` are populated but not surfaced in any tab — either wire into the brief or drop the import.

---

## 7. Security model

**Enforced today:**
- Middleware gates every page + API; only allowlisted emails pass; unauth → `/login` (or 401 for `/api`).
- Roles: `owner` (write) vs `viewer` (read-only, e.g. Karen). Owner checks are server-side, not just hidden UI.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only (never `NEXT_PUBLIC_`, never in client bundle). `.env.local` gitignored.
- Gmail scope is **compose only** (drafts, never auto-send). Text-intel classify route refuses to run on Vercel.
- RLS enabled on financial tables (`lls_*`, `deal_analyses`, `email_briefs`, `email_drafts`).

**Phase 0 hardening — COMPLETE 2026-06-19:**
- ✅ Added `requireOwner()` to `replyToLlsEmail` + `markHandled` (were ungated — a viewer could trigger borrower emails / Lendr comments).
- ✅ Local-dev owner bypass triple-guarded: `NODE_ENV==='development'` **and** `!VERCEL` **and** `JARVIS_LOCAL_BYPASS==='1'` (flag only in local `.env.local`). Cannot activate on any deploy.
- ✅ Explicit auth on API routes: `requireUser()` on `/api/ask` + `/api/tts`, `requireOwner()` on `/api/analyze` (defense-in-depth, no longer middleware-only). `/api/text-intel/classify` already owner-gated + cloud-blocked.
- ✅ Genericized upstream error text returned to client (Lendr, Gmail, ElevenLabs) — logged server-side only.
- ✅ RLS verified **already enabled** on all 16 tables in the live DB (project `hxastxplmyowqmaypqip`), incl. the core tables 0001 missed. Added migration `0008_rls_core_tables.sql` so a fresh rebuild reproduces it (idempotent).

**Operational security (ongoing):**
- **Gmail refresh-token rotation:** the `GMAIL_REFRESH_TOKEN` grants compose scope indefinitely. Rotate every 6–12 months: re-run `npm run gmail-auth`, paste the new token into `.env.local` (local) and Vercel env (prod). Revoke old grants at myaccount.google.com → Security → Third-party access if a leak is suspected.
- Keep `.env.local` off any synced/backup location; it holds the service-role key + Gmail token.

---

## 8. Reference

**Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN`, `LENDR_API_BASE/KEY`, `JARVIS_DIR`, `JARVIS_LOCAL_BYPASS` (local only), `ELEVENLABS_*` (opt), `MS_*` (opt), `OLLAMA_URL` (opt), `INTEL_MODEL`/`DRAFT_MODEL` (opt), `OPP_*` (opt).

**Key paths:**
- App: `~/Developer/jarvis-command-center` (`app/`, `lib/`, `components/`, `scripts/`, `supabase/migrations/`)
- Brain data: `~/Developer/jarvis-brain/jarvis/` (`cards/`, `briefings/`, `state/`) — `JARVIS_DIR` in `.env.local`
- Text intel: `~/Documents/my-ai-team/text-intel/` (pipeline) + `~/text-intel-vault/` (output, chmod 700)
- Opportunity digests: `~/Documents/my-ai-team/sue/trackers/opportunities/`
