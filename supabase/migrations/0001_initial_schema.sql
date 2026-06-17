-- Jarvis Command Center — initial schema
-- Scope: monitor Jarvis fully + surface the Hermes SUE<->Jarvis bridge queue.
-- Mirrors the file-based brain at ~/Desktop/jarvis. Files stay the mechanism;
-- these tables are the cloud view the dashboard reads/writes.

-- ---------- enums ----------
create type seat_kind   as enum ('structural', 'domain');
create type card_tier   as enum ('1', '2', '3');
create type card_status as enum ('pending', 'approved', 'review', 'done', 'dismissed', 'archived');
create type handoff_dir as enum ('to_jarvis', 'from_jarvis');   -- relative to Jarvis
create type handoff_status as enum ('pending', 'in_flight', 'delivered', 'done', 'archived');
create type deal_kind   as enum ('flip', 'multifamily', 'service_business', 'investor', 'titan', 'other');

-- ---------- agents (the seats) ----------
create table agents (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,         -- scout, underwriter, hermes, ...
  kind         seat_kind not null,
  job          text not null,
  online       boolean not null default true,
  last_run_at  timestamptz,
  last_summary text,                          -- what it raised on its last pass
  created_at   timestamptz not null default now()
);

-- ---------- cards (the unit of work) ----------
create table cards (
  id          text primary key,              -- card-0001 (matches the file id)
  title       text not null,
  seat        text not null references agents(name),
  tier        card_tier not null,
  status      card_status not null default 'pending',
  why         text not null,
  action      text,                          -- executable steps (tier 1/2)
  result      text,                          -- NOT done until this is written
  body        text,                          -- free-text context below frontmatter
  file_path   text,                          -- source markdown in ~/Desktop/jarvis
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on cards (status);
create index on cards (seat);

-- ---------- briefings (decision-grade daily brief) ----------
create table briefings (
  id           uuid primary key default gen_random_uuid(),
  brief_date   date not null unique,
  content      text not null,                -- the markdown brief
  delivered_at timestamptz,                  -- when Hermes emailed it
  created_at   timestamptz not null default now()
);

-- ---------- deals (Sales pipeline) ----------
create table deals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        deal_kind not null default 'other',
  stage       text not null default 'new',   -- new -> underwriting -> offer -> ...
  value       numeric,                        -- est. value / loan size
  source      text,                           -- where it came from (e.g. SUE/karen)
  card_id     text references cards(id),       -- the card driving it, if any
  status      text not null default 'open',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- handoffs (the Hermes bridge queue, both directions) ----------
create table handoffs (
  id          uuid primary key default gen_random_uuid(),
  packet_id   text not null unique,           -- hand-2026-06-16-propstream-batch-01
  direction   handoff_dir not null,
  from_party  text not null,                  -- Jarvis/Hermes, Sue, ...
  to_party    text not null,                  -- Sue->karen, Underwriter, ...
  ask         text not null,                  -- the one specific ask
  status      handoff_status not null default 'pending',
  file_path   text,                           -- packet location on disk
  card_id     text references cards(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on handoffs (direction, status);

-- ---------- metrics (the tiles: wake / workflows / spend) ----------
create table metrics (
  id            uuid primary key default gen_random_uuid(),
  metric_date   date not null,
  wakes         int not null default 0,       -- /board passes run
  workflows     int not null default 0,       -- active cards/workflows
  spend_usd     numeric not null default 0,   -- token/API cost
  agents_online int not null default 0,
  created_at    timestamptz not null default now(),
  unique (metric_date)
);

-- ---------- activity (event log -> "what changed") ----------
create table activity (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  actor      text,                            -- which seat / human
  kind       text not null,                   -- card_created, card_done, handoff_sent, brief_delivered, ...
  ref_table  text,
  ref_id     text,
  summary    text not null
);
create index on activity (at desc);

-- ---------- keep updated_at fresh ----------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger t_cards_touch    before update on cards    for each row execute function touch_updated_at();
create trigger t_deals_touch    before update on deals    for each row execute function touch_updated_at();
create trigger t_handoffs_touch before update on handoffs for each row execute function touch_updated_at();
