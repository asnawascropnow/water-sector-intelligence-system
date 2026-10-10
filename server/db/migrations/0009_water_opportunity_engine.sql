-- Migration 0009 — water intelligence & opportunity engine (WSIS Phase 6).
--
-- * water_intervention_types becomes a full catalog: stable key, group, description, deterministic
--   order. Names (the label, stored verbatim in water_opportunities.intervention_type) are unchanged.
--   Two interventions are added for evidence the rule engine can act on: Alternative Water Supply
--   (tanker / borewell dependence) and Integrated Water Management (portfolio / site-wide strategy).
-- * water_opportunities gets the review status model
--     suggested → needs_review → approved | rejected;  approved → converted (linked to CRM) → closed.
--   The Phase 2 statuses map onto it: pursuing → converted (approved when no CRM link), won/lost/dropped
--   → closed with that outcome. No rows are invented; existing rows keep their reviewer and history.
-- * Evidence is stored as structured references (evidence_refs): which fact / field, its value,
--   provenance and source at the time the opportunity was suggested. Facts are versioned (never
--   overwritten), so a fact_id keeps pointing at the exact version that was used.
-- * rule_key / evidence_signature let the engine refresh its own suggestions instead of duplicating
--   them, and not resurface a suggestion a person already rejected on the same evidence.
-- * context_key distinguishes genuinely different opportunities of the same intervention on the same
--   target (e.g. two towers); the live-uniqueness index includes it.
-- Human-in-the-loop rules stay in the database: AI output is labelled AI Inference, nothing passes
-- needs_review without a named reviewer, and only converted/closed rows (or an approved row being
-- converted) can reference a CRM opportunity.

CREATE TABLE water_intervention_groups (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO water_intervention_groups (key, label, sort_order) VALUES
  ('supply',     'Water sources & supply',   10),
  ('treatment',  'Treatment',                20),
  ('reuse',      'Reuse & recycling',        30),
  ('efficiency', 'Efficiency & monitoring',  40),
  ('integrated', 'Integrated / portfolio',   50),
  ('other',      'Other',                    90);

ALTER TABLE water_intervention_types
  ADD COLUMN key TEXT,
  ADD COLUMN group_key TEXT REFERENCES water_intervention_groups(key);

INSERT INTO water_intervention_types (name, sort_order) VALUES
  ('Alternative Water Supply', 0), ('Integrated Water Management', 0);

UPDATE water_intervention_types t SET key = v.key, group_key = v.group_key, sort_order = v.sort_order, description = v.description
  FROM (VALUES
    ('Rainwater Harvesting',          'rainwater_harvesting',          'supply',     10, 'Capturing roof and site run-off for recharge or use'),
    ('Groundwater Management',        'groundwater_management',        'supply',     20, 'Borewell monitoring, recharge and sustainable abstraction'),
    ('Stormwater Management',         'stormwater_management',         'supply',     30, 'Managing site run-off and flooding'),
    ('Alternative Water Supply',      'alternative_water_supply',      'supply',     40, 'Reducing tanker or borewell dependence with other sources'),
    ('Water Treatment',               'water_treatment',               'treatment', 110, 'Treating raw water for process or domestic use'),
    ('Drinking Water Treatment',      'drinking_water_treatment',      'treatment', 120, 'Potable water treatment'),
    ('Wastewater Treatment',          'wastewater_treatment',          'treatment', 130, 'Treating industrial or mixed wastewater (ETP)'),
    ('STP',                           'stp',                           'treatment', 140, 'Sewage treatment plant'),
    ('Greywater Reuse',               'greywater_reuse',               'reuse',     210, 'Reusing lightly used water from baths, basins and laundry'),
    ('Sewage Reuse',                  'sewage_reuse',                  'reuse',     220, 'Reusing treated sewage (STP output) for flushing, landscaping or cooling'),
    ('Water Recycling',               'water_recycling',               'reuse',     230, 'Recycling process or wastewater back into use'),
    ('Smart Water Monitoring',        'smart_water_monitoring',        'efficiency', 310, 'Metering and monitoring of water use'),
    ('Leak Detection',                'leak_detection',                'efficiency', 320, 'Finding and reducing losses in the water network'),
    ('Water Efficiency',              'water_efficiency',              'efficiency', 330, 'Reducing demand: fixtures, process and cooling efficiency'),
    ('Landscaping Water Optimization','landscaping_water_optimization','efficiency', 340, 'Reducing irrigation demand'),
    ('Integrated Water Management',   'integrated_water_management',   'integrated', 410, 'A combined water strategy across a site or portfolio'),
    ('Other',                         'other',                         'other',     999, NULL)
  ) AS v(name, key, group_key, sort_order, description)
 WHERE t.name = v.name;

-- Any intervention added outside this migration still gets a key and a group.
UPDATE water_intervention_types SET key = regexp_replace(lower(name), '[^a-z0-9]+', '_', 'g') WHERE key IS NULL;
UPDATE water_intervention_types SET group_key = 'other' WHERE group_key IS NULL;
ALTER TABLE water_intervention_types ALTER COLUMN key SET NOT NULL, ALTER COLUMN group_key SET NOT NULL;
CREATE UNIQUE INDEX water_intervention_types_key_uq ON water_intervention_types (key);

-- ---------------------------------------------------------------- opportunities

ALTER TABLE water_opportunities
  ADD COLUMN context_key        TEXT NOT NULL DEFAULT '',          -- '' = the intervention for the whole target
  ADD COLUMN rule_key           TEXT,                              -- engine rule that produced the suggestion
  ADD COLUMN evidence_refs      JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  ADD COLUMN evidence_signature TEXT,                              -- stable digest of the evidence used
  ADD COLUMN evidence_current   BOOLEAN NOT NULL DEFAULT TRUE,     -- FALSE: the rule no longer fires on current facts
  ADD COLUMN refreshed_at       TIMESTAMPTZ,
  ADD COLUMN outcome            TEXT CHECK (outcome IN ('won', 'lost', 'not_pursued', 'superseded', 'other')),
  ADD COLUMN updated_by         INTEGER REFERENCES users(id);

ALTER TABLE water_opportunities DROP CONSTRAINT water_opportunities_status_check;
ALTER TABLE water_opportunities DROP CONSTRAINT water_opportunities_check2;
ALTER TABLE water_opportunities DROP CONSTRAINT water_opportunities_check3;
DROP INDEX water_opportunities_live_uq;

UPDATE water_opportunities SET status = CASE WHEN crm_opportunity_id IS NULL THEN 'approved' ELSE 'converted' END WHERE status = 'pursuing';
UPDATE water_opportunities SET outcome = CASE status WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'not_pursued' END, status = 'closed'
 WHERE status IN ('won', 'lost', 'dropped');
UPDATE water_opportunities SET status = 'converted' WHERE status = 'approved' AND crm_opportunity_id IS NOT NULL;

ALTER TABLE water_opportunities ADD CONSTRAINT water_opportunities_status_check
  CHECK (status IN ('suggested', 'needs_review', 'approved', 'rejected', 'converted', 'closed'));
-- A decision (approve / reject / convert / close) needs a named human reviewer.
ALTER TABLE water_opportunities ADD CONSTRAINT water_opportunities_reviewed_check
  CHECK (status IN ('suggested', 'needs_review') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL));
-- CRM links only on reviewed, approved work; 'converted' always has one.
ALTER TABLE water_opportunities ADD CONSTRAINT water_opportunities_crm_check
  CHECK ((crm_opportunity_id IS NULL OR status IN ('approved', 'converted', 'closed')) AND (status <> 'converted' OR crm_opportunity_id IS NOT NULL));
ALTER TABLE water_opportunities ADD CONSTRAINT water_opportunities_outcome_status_check
  CHECK (outcome IS NULL OR status = 'closed');

-- No duplicate live opportunity for the same target, intervention and context.
CREATE UNIQUE INDEX water_opportunities_live_uq
  ON water_opportunities (coalesce(project_id, 0), coalesce(organization_id, 0), intervention_type, context_key)
  WHERE status NOT IN ('rejected', 'closed');
CREATE INDEX water_opportunities_crm_idx ON water_opportunities (crm_opportunity_id) WHERE crm_opportunity_id IS NOT NULL;
