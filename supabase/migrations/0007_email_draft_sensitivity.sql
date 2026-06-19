-- Jarvis Command Center — widen reply coverage to ALL reply-needed threads.
--
-- Change of posture (2026-06-19): the drafter no longer HARD-EXCLUDES sensitive
-- threads (investor/LP, loan-status, pricing/terms, partner-sensitive, money/wire,
-- signature/legal). Collin wants a prepopulated reply ready for EVERY email that
-- needs one. So those threads now get a draft too — but a deliberately SAFE one
-- (never confirms wire/bank details, never commits to a number/price/legal term;
-- steers to "let's get on a call" / "send it over and I'll review") and they're
-- flagged sensitive so the /replies card shows a caution badge. Collin still
-- approves every reply before it sends — nothing dangerous auto-goes-out.
--
-- Only genuinely no-reply threads (newsletters, receipts, FYI, auto-notices) are
-- still skipped. category becomes 'reply' | 'no-reply-needed' going forward;
-- legacy 'routine'/'excluded' rows still read fine.

alter table email_drafts
  add column if not exists sensitivity text not null default 'normal'; -- normal | sensitive

-- excluded_reason is repurposed as the caution reason for sensitive threads.
comment on column email_drafts.excluded_reason is
  'For sensitive threads: why it needs extra care (wire/money, investor, loan, pricing, partner, signature). For legacy excluded rows: why it was skipped.';
