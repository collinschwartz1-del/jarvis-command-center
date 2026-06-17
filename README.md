# Jarvis Command Center

A web "face" on the file-based Jarvis ops brain (`~/Desktop/jarvis`). Dark
command-center dashboard — Core / Agents / Projects / Sales / Bridge / Ask —
reading live from a dedicated Supabase project, with two-way card approval and a
Claude-powered Ask chat.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Local-only for now — no auth yet, so don't expose it publicly (it shows
financial data). Auth + deploy is the next phase.

## How the data flows

```
~/Desktop/jarvis (markdown brain)  ──npm run sync──▶  Supabase  ──▶  dashboard
        ▲                                                │
        └────────── approve in UI writes back ───────────┘
```

- **`npm run sync`** — reads cards + briefings from `$JARVIS_DIR` and upserts
  them into Supabase, then recomputes the metric tiles. Run after each `/board`.
- **Approve / Dismiss** on the Projects page updates Supabase *and* flips the
  `status:` line in the source card file, so the next `/pickup` sees it.
- **Ask** streams from `claude-opus-4-8`, grounded in the live command-center
  state (needs `ANTHROPIC_API_KEY`).

## Always-on

`scripts/morning-board.sh` runs a `/board` pass then syncs. Schedule it:

```bash
(crontab -l 2>/dev/null; echo "0 7 * * * $HOME/Desktop/jarvis-command-center/scripts/morning-board.sh >> /tmp/jarvis-board.log 2>&1") | crontab -
```

## Config (`.env.local`)

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side reads/writes (secret) |
| `JARVIS_DIR` | path to the Jarvis brain for sync + write-back |
| `ANTHROPIC_API_KEY` | powers the Ask chat |

## Stack
Next.js 15 (App Router) · Tailwind v4 · Supabase · Anthropic SDK · lucide-react.

## Roadmap
- ✅ Phase 1 — Supabase schema + data
- ✅ Phase 2 — read dashboard
- ✅ Phase 3 — card approve/dismiss write-back
- ✅ Phase 4 — sync runner, closed loop, Ask chat, scheduled /board
- ⬜ Phase 5 — Supabase Auth + Vercel deploy + phone access
