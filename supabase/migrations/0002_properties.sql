-- Jarvis Command Center — real estate portfolio (PGO / FolioExcel)
-- Holds the property-level financial summary pulled from FolioExcel
-- (app.folioexcel.com/company/pgo/financials). FolioExcel has no API, so the
-- mechanism is: export -> scripts/import-folio.mjs -> this table + a markdown
-- summary in ~/Desktop/jarvis. Idempotent on (folio_company, name, as_of_date).
--
-- `raw jsonb` keeps the full original export row, so nothing is lost even when
-- a column doesn't map to a typed field — we can re-map later without re-export.

create table if not exists properties (
  id                   uuid primary key default gen_random_uuid(),
  folio_company        text not null default 'pgo',   -- the FolioExcel /company/<x> slug
  name                 text not null,                  -- property name as it appears in Folio
  address              text,
  city                 text,
  state                text,
  zip                  text,
  asset_type           text,                           -- multifamily | flip | commercial | other
  status               text default 'owned',           -- owned | under_contract | sold
  units                int,
  as_of_date           date,                           -- reporting period end this row reflects
  occupancy            numeric,                        -- percent (0-100)
  gross_potential_rent numeric,
  actual_revenue       numeric,
  operating_expenses   numeric,
  noi                  numeric,
  debt_service         numeric,
  cash_flow            numeric,
  market_value         numeric,
  loan_balance         numeric,
  equity               numeric,                        -- market_value - loan_balance (derived if absent)
  cap_rate             numeric,
  dscr                 numeric,
  ownership_pct        numeric,
  notes                text,
  source               text not null default 'folioexcel',
  raw                  jsonb,                          -- full original export row, verbatim
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (folio_company, name, as_of_date)
);
create index if not exists properties_company_idx on properties (folio_company);
create index if not exists properties_as_of_idx   on properties (as_of_date desc);

create trigger t_properties_touch before update on properties
  for each row execute function touch_updated_at();

-- Portfolio rollup the dashboard tiles + the morning brief read from.
-- Uses the latest as_of_date per property so a mid-month partial export
-- doesn't double-count against last month's full one.
-- security_invoker so the view runs with the querying role's rights, not the
-- creator's (clears the security_definer_view advisor).
create view portfolio_summary with (security_invoker = on) as
with latest as (
  select distinct on (folio_company, name) *
  from properties
  order by folio_company, name, as_of_date desc nulls last
)
select
  folio_company,
  count(*)                              as property_count,
  coalesce(sum(units), 0)               as total_units,
  round(avg(occupancy), 1)              as avg_occupancy,
  sum(market_value)                     as total_value,
  sum(loan_balance)                     as total_debt,
  sum(coalesce(equity, market_value - loan_balance)) as total_equity,
  sum(noi)                              as total_noi,
  sum(cash_flow)                        as total_cash_flow,
  case when sum(market_value) > 0
       then round(sum(noi) / sum(market_value) * 100, 2) end as portfolio_cap_rate,
  max(as_of_date)                       as latest_as_of
from latest
group by folio_company;

-- RLS: investor-sensitive financials. Match the other tables — RLS on with no
-- public policy, so the table is reachable only via the service_role key the
-- dashboard uses server-side (supabaseAdmin) and the import script's writes.
-- The anon/publishable key (exposed in the browser) sees nothing.
alter table properties enable row level security;
