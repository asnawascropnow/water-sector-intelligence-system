-- Migration 0010 — CRM for both pipelines (WSIS Phase 7).
--
-- * Project pipeline outcomes: 'Lost' (lost) and 'Nurture' (open, beside the main track), matching the
--   relationship pipeline's outcome model. 'Won' stays the only won stage. Existing stages are unchanged.
-- * crm_opportunities.potential — the team's own judgement of this opportunity (High/Medium/Low/Unknown).
--   NULL means not set; the organization's AI-inferred potential is shown separately and labelled.
-- * crm_opportunities.source_water_opportunity_id — the approved water opportunity a CRM opportunity
--   was converted from (the CRM record keeps its link back). Backfilled from existing conversions.
-- * tasks.project_id and activities.project_id — tasks and timeline entries can carry project context
--   directly. Backfilled only from the opportunity they already belong to (nothing invented).
-- Additive only; no existing row loses data.

INSERT INTO pipeline_stages (pipeline, name, sort_order, kind, is_outcome, milestone) VALUES
  ('project', 'Lost',    100, 'lost', TRUE, NULL),
  ('project', 'Nurture', 110, 'open', TRUE, NULL);

ALTER TABLE crm_opportunities
  ADD COLUMN potential TEXT CHECK (potential IN ('High', 'Medium', 'Low', 'Unknown')),
  ADD COLUMN source_water_opportunity_id INTEGER REFERENCES water_opportunities(id);

UPDATE crm_opportunities c SET source_water_opportunity_id = w.id
  FROM (SELECT DISTINCT ON (crm_opportunity_id) id, crm_opportunity_id FROM water_opportunities
         WHERE crm_opportunity_id IS NOT NULL ORDER BY crm_opportunity_id, id) w
 WHERE w.crm_opportunity_id = c.id;

ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id);
UPDATE tasks t SET project_id = o.project_id FROM crm_opportunities o WHERE o.id = t.opportunity_id AND o.project_id IS NOT NULL;
CREATE INDEX tasks_opportunity_idx ON tasks (opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX tasks_project_idx ON tasks (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE activities ADD COLUMN project_id INTEGER REFERENCES projects(id);
UPDATE activities a SET project_id = o.project_id FROM crm_opportunities o WHERE o.id = a.opportunity_id AND o.project_id IS NOT NULL;
CREATE INDEX activities_project_idx ON activities (project_id, occurred_at DESC) WHERE project_id IS NOT NULL;

CREATE INDEX crm_opportunities_pipeline_idx ON crm_opportunities (pipeline, status);
