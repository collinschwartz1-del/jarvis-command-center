# Phase 5 — Deploy (auth + Vercel)

The dashboard is now gated: every page and API route requires an authed,
allowlisted session. Public routes: `/login`, `/auth/*`.

## 1. Supabase Auth config (required for magic links to work)

Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:3000` (change to your Vercel URL after deploy)
- **Redirect URLs — add both:**
  - `http://localhost:3000/**`
  - `https://<your-vercel-subdomain>.vercel.app/**` (after deploy)

Email auth is on by default; magic links use Supabase's built-in email
(rate-limited but fine for one user). No password is ever created.

## 2. Test login locally first

1. `npm run dev` → open `http://localhost:3000` → you're redirected to `/login`.
2. Enter an allowlisted email (see `ALLOWED_EMAILS` in `.env.local`).
3. Open the magic link from your inbox on the same device → lands you in.

## 3. Deploy to Vercel

From this directory:

```bash
npx vercel            # first run: log in + link the project (creates a *.vercel.app)
npx vercel --prod     # production deploy
```

Then set environment variables (Vercel Dashboard → Project → Settings →
Environment Variables, or `npx vercel env add`):

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | from `.env.local` (secret) |
| `ANTHROPIC_API_KEY` | from `.env.local` (secret) |
| `ALLOWED_EMAILS` | `collinschwartz1@gmail.com,collin@leavenwealth.com` |

Do **not** set `JARVIS_DIR` in Vercel — file sync/write-back run only on your
Mac. Redeploy after adding env vars. Then add the Vercel URL to the Supabase
Site URL + Redirect URLs (step 1).

## What runs where (by design)
- **Cloud (Vercel):** the dashboard — read data, approve cards (DB), Ask, analyze.
- **Local (your Mac):** the morning `/board`, inbox/deal ingest, file write-back,
  and `npm run sync` — these touch local files + your mailbox, and push to
  Supabase. The cloud app only reads Supabase. Smaller attack surface; your
  mailbox creds never leave your machine.

## Safety posture
- Service-role key is server-only (never shipped to the browser).
- All routes gated by `middleware.ts` (allowlist in `ALLOWED_EMAILS`).
- Set a **monthly spend cap** in the Anthropic console — a hard ceiling on the
  Ask/analyze endpoints.
