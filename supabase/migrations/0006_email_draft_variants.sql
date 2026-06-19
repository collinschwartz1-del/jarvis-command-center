-- Jarvis Command Center — reply variants + dashboard approval (extends email_drafts).
--
-- Two changes to the email reply pipeline:
--   1. Decision emails (yes/no, and/or) get MULTIPLE prepopulated replies instead
--      of one. Each option is a labeled variant ({label, body, verdict, note}) that
--      Sue reviews individually. Collin picks ONE from the Jarvis /replies tab.
--   2. Approval moves to the dashboard. The script no longer writes the Gmail draft
--      itself — it stages Sue-approved rows as status 'pending'. Collin picks a
--      variant in /replies and the approve action writes the Gmail draft on the
--      thread (existing gmail.compose scope — still never auto-sends).
--
-- Lifecycle (status): pending | approved | held | excluded | dismissed
--   pending  = >=1 variant cleared Sue; waiting on Collin's pick in the dashboard
--   approved = Collin picked a variant; Gmail draft written on the thread
--   held     = Sue held every variant (nothing safe to surface)
--   excluded = scope gate excluded the thread (investor/LP, loan, wire, …)
--   dismissed= Collin dismissed it from the dashboard
-- (legacy 'drafted'/'written'/'sent' rows from before this migration still read fine.)

alter table email_drafts
  add column if not exists reply_kind      text not null default 'single',  -- single | decision
  add column if not exists variants        jsonb not null default '[]'::jsonb, -- [{label, body, verdict, note}]
  add column if not exists chosen_index    int,                              -- which variant Collin approved
  add column if not exists original_snippet text,                           -- inbound text being replied to (dashboard context)
  add column if not exists reply_to_message_id text,                        -- inbound Message-ID header (RFC threading)
  add column if not exists reply_references    text;                        -- inbound References header (RFC threading)

-- The dashboard queue reads pending rows newest-first.
create index if not exists email_drafts_status_idx on email_drafts (status, created_at desc);
