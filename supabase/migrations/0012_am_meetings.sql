-- am_meetings: this-week's LeavenWealth asset-management meetings, pulled from
-- Collin's Outlook/M365 calendar by the "LW Meeting Sync" cloud routine (which has
-- the Microsoft 365 connector) and consumed by scripts/asset-intel-report.mjs so the
-- weekly Owner Brief times its agendas to real meeting slots instead of a Mon 8am
-- default. The brief (GitHub Actions) can read Supabase but cannot reach the M365
-- connector — this table is the handoff bus between the two.
--
-- agenda_bucket maps each meeting to a buildAgendas() key:
--   huddle | warRoom | redZoneCmd | leadership | stabilized | other
create table if not exists am_meetings (
  event_id      text primary key,        -- Outlook event id (idempotent upsert key)
  subject       text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  organizer     text,
  agenda_bucket text,                     -- buildAgendas() key, or 'other'
  week_id       text,                     -- ISO week, e.g. 2026-W27 (convenience)
  synced_at     timestamptz not null default now(),
  raw           jsonb
);
create index if not exists am_meetings_starts_idx on am_meetings (starts_at);

alter table am_meetings enable row level security;
-- service role (used by the brief + the sync routine) bypasses RLS; no anon policy
-- on purpose — meeting data is owner-only and never exposed to the dashboard anon key.
