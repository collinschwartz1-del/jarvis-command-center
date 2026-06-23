-- Jarvis Command Center — PGO (Point Guard Omaha) property-management dashboard
-- Source of truth is the live Buildium export in BigQuery
-- (api-data-pull-492404.pgo_shared). scripts/pgo-sync.mjs queries the authorized
-- views on a schedule, computes a portfolio snapshot + per-property rollup, and
-- upserts these tables; app/pgo reads them. The BigQuery service-account key is
-- local-only, so the *dashboard* never touches BQ directly — it reads this cache
-- (works on Vercel where the key file doesn't exist), same pattern as LLS/Lendr.
--
-- Scope note: CapEx / unit-turn views are intentionally out of scope (per the
-- PGO data agreement with John). Recurring charges (rent roll) is pending a
-- base-table grant from John — its columns stay null until that lands.

-- ---------- pgo_snapshot (time-series portfolio snapshot) ----------
-- One row per sync. Newest row = current state. Scalars are extracted for fast
-- tile reads; `raw` keeps the full computed payload (6-month NOI trend, A/R
-- aging, per-property detail) so the UI can render extras without schema churn.
create table if not exists pgo_snapshot (
  id                  uuid primary key default gen_random_uuid(),
  captured_at         timestamptz not null default now(),
  period              text not null,                 -- latest financial month 'YYYY-MM'
  property_count      int,
  operating_income    numeric,                       -- sum t12_section='income'  (latest month)
  operating_expense   numeric,                       -- sum t12_section='expense' (latest month)
  noi                 numeric,                        -- operating_income - operating_expense
  noi_prior           numeric,                        -- prior month NOI (for MoM)
  ar_total            numeric,                        -- total delinquent balance (latest day)
  ar_0_30             numeric,
  ar_31_60            numeric,
  ar_61_90            numeric,
  ar_over_90          numeric,
  evictions_pending   int,
  notices_given       int,
  delinquency_date    date,                           -- snapshot_date the A/R figures reflect
  raw                 jsonb not null,                 -- { trend:[], aging:{}, properties:[] }
  created_at          timestamptz not null default now()
);
create index if not exists pgo_snapshot_captured_idx on pgo_snapshot (captured_at desc);

-- ---------- pgo_properties (one row per property, latest figures) ----------
-- Upserted each sync (keyed on Buildium property_id). Drives the sortable
-- per-property table on /pgo.
create table if not exists pgo_properties (
  property_id         bigint primary key,             -- Buildium property_id
  property_name       text,
  period              text,                           -- financial month these figures reflect
  operating_income    numeric,
  operating_expense   numeric,
  noi                 numeric,
  ar_total            numeric,
  ar_over_90          numeric,
  evictions_pending   int,
  units_delinquent    int,
  updated_at          timestamptz not null default now()
);
create index if not exists pgo_properties_noi_idx on pgo_properties (noi desc nulls last);

-- ---------- pgo_reports (archived weekly report PDFs) ----------
-- Mirrors lls_reports. `period` is the report's week id (e.g. '2026-W25').
create table if not exists pgo_reports (
  period         text primary key,
  drive_file_id  text,
  web_view_link  text,
  title          text,
  generated_at   timestamptz not null default now()
);

-- RLS: property financials are sensitive. Match the other Jarvis tables — RLS on
-- with no public policy, so reachable only via the service_role key the dashboard
-- uses server-side (supabaseAdmin) and the sync/report scripts' writes. The
-- anon/publishable key (exposed in the browser) sees nothing.
alter table pgo_snapshot   enable row level security;
alter table pgo_properties enable row level security;
alter table pgo_reports    enable row level security;
