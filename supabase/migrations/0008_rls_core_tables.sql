-- Phase 0 hardening (2026-06-19): the core Jarvis tables were created in 0001
-- with no Row-Level Security, so the browser anon/publishable key could read
-- them directly (cards, briefings, deals, handoffs, metrics, activity, agents
-- — pipeline value, decision content, handoff details).
--
-- The dashboard only ever reads these server-side with the service_role key
-- (supabaseAdmin), which bypasses RLS — so enabling RLS with NO policy locks
-- them to server-side access only, matching every other table, with zero app
-- breakage. Defense-in-depth before scaling access.
alter table agents    enable row level security;
alter table cards     enable row level security;
alter table briefings enable row level security;
alter table deals     enable row level security;
alter table handoffs  enable row level security;
alter table metrics   enable row level security;
alter table activity  enable row level security;
