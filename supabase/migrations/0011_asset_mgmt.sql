-- LeavenWealth Asset Management Operating System cache.
-- am_snapshot: latest classification + agendas + owner brief (jsonb), written by
-- scripts/pgo-sync.mjs (deterministic, daily) and enriched weekly by
-- scripts/asset-intel-report.mjs with the AI owner summary. app/asset-mgmt reads it.
create table if not exists am_snapshot (
  id            uuid primary key default gen_random_uuid(),
  captured_at   timestamptz not null default now(),
  period        text,
  red_count     int,
  nonstab_count int,
  stab_count    int,
  total_count   int,
  raw           jsonb not null,  -- { classification, agendas, ownerBrief, changes, ai }
  created_at    timestamptz not null default now()
);
create index if not exists am_snapshot_captured_idx on am_snapshot (captured_at desc);

-- am_reports: archived weekly owner briefs (PDF + link), mirrors pgo_reports.
create table if not exists am_reports (
  period         text primary key,
  drive_file_id  text,
  web_view_link  text,
  title          text,
  generated_at   timestamptz not null default now()
);

alter table am_snapshot enable row level security;
alter table am_reports  enable row level security;
