-- Jarvis Command Center — email reply pipeline (email_drafts)
-- scripts/draft-replies.mjs reads the last 48h of Gmail (same pull as intel.mjs),
-- gates each thread to "narrow / low-risk routine replies only", drafts a reply
-- in Collin's voice, runs it through a Sue review pass (Collin's Approval Rules
-- + voice lens), and — only for Sue-approved drafts — saves a Gmail DRAFT on the
-- thread. Final approval is Collin reviewing/sending in Gmail. Nothing auto-sends.
--
-- This table is the record + audit trail: what was drafted, Sue's verdict, and
-- whether a Gmail draft was actually written. One row per (thread, run).
create table email_drafts (
  id              uuid primary key default gen_random_uuid(),
  gmail_thread_id text,                       -- thread the draft is attached to
  gmail_msg_id    text,                       -- the message being replied to
  gmail_draft_id  text,                       -- Gmail's draft id once written (null if held/dry-run)
  person_name     text,
  person_email    text,
  subject         text,
  -- gate / classification
  category        text,                       -- routine | excluded | no-reply-needed
  excluded_reason text,                       -- why it was skipped (investor/LP, loan, partner, money, wire, …)
  -- the draft + Sue's review
  draft_body      text,                       -- the proposed reply (Collin's voice)
  sue_verdict     text not null default 'pending', -- approve | hold | pending
  sue_note        text,                       -- Sue's reasoning / what to fix if held
  -- lifecycle
  status          text not null default 'drafted',  -- drafted | held | written | sent | dismissed
  written_at      timestamptz,                -- when the Gmail draft was created
  created_at      timestamptz not null default now()
);
create index on email_drafts (created_at desc);
create index on email_drafts (gmail_thread_id);

-- Same posture as email_briefs / deal_analyses: server-side (service_role) only.
-- Enabling RLS with no policy locks it to the service key the scripts + dashboard
-- use, and keeps it off the browser anon/publishable key.
alter table email_drafts enable row level security;
