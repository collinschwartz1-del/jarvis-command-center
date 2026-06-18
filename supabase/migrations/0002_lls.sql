-- Jarvis Command Center — LLS (Liquid Lending Solutions) lending dashboard
-- Source of truth is Lendr (loans/capital) + Gmail (borrower-request mail).
-- scripts/lls-sync.mjs pulls both on a schedule and upserts these tables;
-- app/lending reads them. No money movement, no auto-send — drafts only.

-- ---------- lls_snapshot (time-series fund snapshot) ----------
-- One row per sync. Newest row = current state. Scalars are extracted for fast
-- tile reads; `raw` keeps the full Lendr dashboard-stats payload (charts,
-- concentration, lender_earnings, pipeline_vs_payoffs) so the UI can render
-- extras without schema churn.
create table lls_snapshot (
  id                   uuid primary key default gen_random_uuid(),
  captured_at          timestamptz not null default now(),
  available_capital    numeric,
  outstanding_capital  numeric,
  total_capital        numeric,
  aged_receivables     numeric,
  portfolio_ltv        numeric,
  avg_monthly_interest numeric,
  unique_borrowers     int,
  active_loan_count    int,
  pipeline_value       numeric,
  pipeline_count       int,
  payoffs_30d_total    numeric,
  payoffs_30d_count    int,
  originations_30d_total numeric,
  originations_30d_count int,
  raw                  jsonb not null,
  created_at           timestamptz not null default now()
);
create index on lls_snapshot (captured_at desc);

-- ---------- lls_loans (one row per Lendr loan, active + pipeline) ----------
create table lls_loans (
  lendr_id              text primary key,        -- Lendr loan id
  borrower_name         text,
  address               text,
  city                  text,
  state                 text,
  zip                   text,
  amount                numeric,
  outstanding_principal numeric,
  status                text,                     -- raw Lendr status slug
  stage                 text,                     -- human-readable stage label
  lien_position         text,
  property_type         text,
  rate                  numeric,
  origination_date      date,
  payoff_date           date,
  loan_type             text not null default 'active',  -- active | pipeline
  updated_at            timestamptz not null default now()
);
create index on lls_loans (loan_type);
create index on lls_loans (payoff_date);

-- ---------- lls_loan_comments (Lendr team feedback that carries through) ----------
create table lls_loan_comments (
  lendr_comment_id text primary key,
  loan_id          text not null references lls_loans(lendr_id) on delete cascade,
  author           text,
  body             text not null,
  created_at       timestamptz not null,
  synced_at        timestamptz not null default now()
);
create index on lls_loan_comments (loan_id, created_at desc);

-- ---------- lls_inbox (borrower-request emails, surfaced under the stats) ----------
create table lls_inbox (
  gmail_message_id text primary key,
  gmail_thread_id  text not null,
  from_name        text,
  from_email       text,
  subject          text,
  snippet          text,
  body             text,
  received_at      timestamptz,
  category         text,            -- borrower-request | draw | payoff | notification | other
  request_summary  text,            -- Claude's 1-line extraction of the ask
  priority         int not null default 0,   -- higher = pinned higher (Luke/Angie boosted)
  matched_loan_id  text references lls_loans(lendr_id) on delete set null,
  handled          boolean not null default false,
  updated_at       timestamptz not null default now()
);
create index on lls_inbox (handled, priority desc, received_at desc);

-- ---------- lls_reports (monthly financial report archive, PDF in Drive) ----------
create table lls_reports (
  period        text primary key,        -- YYYY-MM (the month the report covers)
  drive_file_id text,
  web_view_link text,
  title         text,
  generated_at  timestamptz not null default now()
);

-- keep updated_at fresh (reuse touch_updated_at() from migration 0001)
create trigger t_lls_loans_touch before update on lls_loans
  for each row execute function touch_updated_at();
create trigger t_lls_inbox_touch before update on lls_inbox
  for each row execute function touch_updated_at();

-- ---------- RLS ----------
-- These tables are read/written only through the service-role client
-- (supabaseAdmin()), which bypasses RLS. Enabling RLS with NO policies blocks
-- the public anon/authenticated roles (the NEXT_PUBLIC anon key) from reaching
-- borrower + loan financial data, while the server-side app keeps working.
alter table lls_snapshot      enable row level security;
alter table lls_loans         enable row level security;
alter table lls_loan_comments enable row level security;
alter table lls_inbox         enable row level security;
alter table lls_reports       enable row level security;
