-- Close two RLS holes flagged by the security advisor: email_briefs and
-- deal_analyses were public (readable via the browser anon/publishable key).
-- The dashboard reads them server-side with the service_role key
-- (supabaseAdmin), which bypasses RLS, so enabling RLS with no policy locks
-- them to server-side access only — matching every other table — with no
-- app breakage.
alter table email_briefs  enable row level security;
alter table deal_analyses enable row level security;
