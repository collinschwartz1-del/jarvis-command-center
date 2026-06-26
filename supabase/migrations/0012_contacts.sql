-- 0012_contacts.sql — Collin's World CRM: the unified contact master, inside Jarvis.
--
-- ONE table holds every contact pool. Each row is tagged by SOURCE (where it came
-- from — the UI's source tabs filter on this) and PURPOSE (what the contact is FOR).
-- The "All People" master tab dedupes across sources by normalized email/phone so
-- the same person spread across Lendr + Titan + Gmail collapses to one identity.
--
-- Import model = one-time / refresh-on-demand (Collin's low-management pref). The
-- per-source importer scripts (Phase 2) upsert keyed on (source, source_id), so a
-- Refresh re-pull updates in place instead of duplicating. Nothing auto-syncs.
--
-- Consent guardrail: cold pools (legacy RE list, off-market owner sourcing) import
-- with consent_status='do_not_bulk' by default so a stray bulk email can never
-- torch sending reputation / trip CAN-SPAM.

create table if not exists contacts (
  id             uuid primary key default gen_random_uuid(),
  source         text not null,          -- collins_world | lendr | titan | legacy_re | clickup | gmail | deal_engine | buildium | fb_meetup
  source_id      text,                   -- stable id within that source (loan/borrower id, sheet row, email)
  first_name     text,
  last_name      text,
  full_name      text,                   -- for sources that hand back a single name field
  email          text,
  email_norm     text,                   -- lower(trim(email)) — dedup key for the master view
  phone          text,
  phone_norm     text,                   -- digits only — dedup key for the master view
  company        text,
  purpose        text,                   -- what this contact is FOR (borrower, Titan member, event attendee, seller lead)
  segment        text,                   -- finer tag within purpose
  consent_status text not null default 'unknown',  -- opt_in | unknown | do_not_bulk
  owner          text,                   -- who owns the relationship
  date_added     date not null default current_date,
  last_touch     timestamptz,
  notes          text,
  raw            jsonb,                  -- full source record, kept for re-mapping later
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One row per (source, source_id) so refresh re-imports upsert cleanly instead of
-- piling up duplicates. Full (non-partial) so it can serve as an ON CONFLICT
-- arbiter for the importer's upsert; every importer always sets source_id.
create unique index if not exists contacts_source_key
  on contacts (source, source_id);

create index if not exists contacts_source_idx     on contacts (source);
create index if not exists contacts_email_norm_idx  on contacts (email_norm);
create index if not exists contacts_phone_norm_idx  on contacts (phone_norm);

-- Server-side only. This table concentrates PII (phones, emails, borrower data),
-- so RLS-on + NO policy locks it to the service_role key (supabaseAdmin) exactly
-- like every other Jarvis table — the browser publishable key can't read it.
alter table contacts enable row level security;

-- Aggregated count views. The page reads these instead of counting rows client-
-- side, because Supabase caps a single .select() at 1000 rows — counting in JS
-- made the header read "~1000 across 4 sources" no matter the true total.
create or replace view v_contact_source_counts as
  select source, count(*)::int as n,
         count(*) filter (where phone is not null)::int as has_phone
  from contacts group by source;

create or replace view v_contact_stats as
  select count(*)::int as total,
         count(distinct coalesce(email_norm, phone_norm))::int as distinct_people,
         count(distinct source)::int as sources
  from contacts;
