-- 0014_draft_feedback.sql
-- The self-learning loop for the email-reply pipeline.
--
-- Every time Collin acts on a staged reply in /replies (dismiss, edit-then-stage,
-- or stage-as-is) we record the signal here. draft-replies.mjs reads the most
-- recent signals at the START of each run and feeds them to the drafter + Sue as
-- "here's what Collin actually rejected / corrected" — so the pipeline adapts to
-- his real preferences instead of a frozen prompt. This is the mechanism that
-- makes the process improve itself over time.
create table if not exists public.draft_feedback (
  id           uuid primary key default gen_random_uuid(),
  -- which draft this verdict was about (free-floating; we keep the text inline so
  -- learning survives even if the email_drafts row is later pruned).
  draft_id     uuid,
  thread_id    text,
  person_email text,
  subject      text,
  -- the draft body Collin saw, and (for edits) what he changed it to.
  draft_body   text,
  edited_body  text,
  -- the learning signal:
  --   dismissed  — he threw the draft away without sending (negative example)
  --   edited     — he kept it but rewrote it (draft_body -> edited_body = a correction)
  --   approved   — he staged it as-is to Gmail (positive example)
  signal       text not null check (signal in ('dismissed','edited','approved')),
  reason       text,
  created_at   timestamptz not null default now()
);

create index if not exists draft_feedback_recent_idx
  on public.draft_feedback (created_at desc);

alter table public.draft_feedback enable row level security;

-- Service-role only (same posture as email_drafts): the cron writer and the
-- server actions use the service key; no anon/auth client touches this table.
drop policy if exists "service role full access" on public.draft_feedback;
create policy "service role full access" on public.draft_feedback
  for all to service_role using (true) with check (true);
