-- Jarvis Inbox triage upgrade (2026-06-21): turn the Inbox from a flat digest
-- into an action-first triage. Three pieces:
--
--   1. email_briefs.category — per-person bucket so the UI groups
--      sign / question / awaiting / fyi instead of a volume-sorted dump.
--
--   2. inbox_muted — audit log of the machine-noise senders Jarvis suppressed
--      this run (Google / Vercel / Cloudflare / self-automation). The "N muted"
--      counter on /inbox reads this so Collin can click to audit what was hidden.
--      Muting NEVER touches Gmail — the mail stays in the real inbox.
--
--   3. inbox_suppressions — Collin's "I already handled this" memory. When he
--      dismisses an action item (or clears a wire flag), we remember its
--      signature so the next intel cron can't re-raise it. This ends the
--      Kathleen-Miller wire re-nag loop, where a stateless rerun kept flagging a
--      thread he'd already cleared in a reply.

create extension if not exists pgcrypto;

alter table email_briefs
  add column if not exists category text not null default 'fyi'; -- sign | question | awaiting | fyi

create table if not exists inbox_muted (
  id          uuid primary key default gen_random_uuid(),
  from_name   text,
  from_email  text,
  subject     text,
  reason      text,                              -- sender:<x> | pattern:<x>
  muted_at    timestamptz not null default now()
);

create table if not exists inbox_suppressions (
  id           uuid primary key default gen_random_uuid(),
  person_email text not null,
  signature    text not null,                    -- actionSignature(item) or 'wire'
  kind         text not null default 'action',   -- action | wire
  reason       text,
  created_at   timestamptz not null default now(),
  unique (person_email, signature)
);

create index if not exists inbox_suppressions_person_idx
  on inbox_suppressions (person_email);

-- Same server-only posture as every other table (see 0004 / 0008): RLS on, no
-- policy, so only the service_role key (supabaseAdmin / the cron) can touch
-- these. The browser publishable key sees nothing.
alter table inbox_muted        enable row level security;
alter table inbox_suppressions enable row level security;
