-- Soft-void instead of hard-delete: a mis-clicked disposition/note is marked
-- voided (kept for audit) and stripped of effect, never destroyed.
-- Applied to the deal-command-center spine (nhsmylrypwmhhjfbddox).
alter table hub_lead_event
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by text;

-- Activity feed: keep voided rows visible, expose the flag (appended at END so
-- CREATE OR REPLACE keeps the existing column order).
create or replace view v_call_log as
 SELECT e.id,
    e.lead_id,
    e.event_type,
    e.channel,
    e.actor,
    e.detail ->> 'outcome'::text AS outcome,
    COALESCE(e.detail ->> 'notes'::text, e.detail ->> 'note'::text) AS note,
    e.created_at,
    p.display_address,
    l.score,
    l.status,
    ( SELECT o.display_name
           FROM hub_property_owner po
             JOIN hub_owner o ON o.id = po.owner_id
          WHERE po.property_id = p.id
          ORDER BY po.owner_id
         LIMIT 1) AS owner_name,
    e.voided_at,
    e.voided_by
   FROM hub_lead_event e
     JOIN hub_lead l ON l.id = e.lead_id
     JOIN hub_property p ON p.id = l.property_id
  WHERE (e.event_type = ANY (ARRAY['outreach'::text, 'note'::text]))
    AND COALESCE(e.detail ->> 'outcome'::text, e.detail ->> 'note'::text, e.detail ->> 'notes'::text) IS NOT NULL;

-- Latest-disposition rollup (Hot + Callbacks): a voided entry must NOT count as
-- the current state.
create or replace view v_lead_latest_outreach as
 SELECT DISTINCT ON (e.lead_id) e.lead_id,
    e.actor,
    e.detail ->> 'outcome'::text AS outcome,
    COALESCE(e.detail ->> 'notes'::text, e.detail ->> 'note'::text) AS note,
    e.created_at,
    p.display_address,
    l.score,
    ( SELECT o.display_name
           FROM hub_property_owner po
             JOIN hub_owner o ON o.id = po.owner_id
          WHERE po.property_id = p.id
          ORDER BY po.owner_id
         LIMIT 1) AS owner_name
   FROM hub_lead_event e
     JOIN hub_lead l ON l.id = e.lead_id
     JOIN hub_property p ON p.id = l.property_id
  WHERE e.event_type = 'outreach'::text
    AND (e.detail ->> 'outcome'::text) IS NOT NULL
    AND e.voided_at IS NULL
  ORDER BY e.lead_id, e.created_at DESC;
