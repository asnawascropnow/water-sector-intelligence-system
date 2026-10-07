-- Migration 0004 — water opportunities foundation (WSIS Phase 2).
--
-- A water opportunity is a potential water intervention (rainwater harvesting, STP, greywater reuse,
-- leak detection, …) on a project, an organization, or a specific organization on a project.
--
-- Human-in-the-loop rules enforced by the database, not just the application:
--  * Every opportunity starts as 'suggested' unless a named person reviewed it (reviewed_by/at).
--    An AI-generated opportunity therefore cannot become approved/pursued without a human reviewer.
--  * Only a reviewed, non-rejected opportunity can be linked to a CRM opportunity. Nothing here
--    creates CRM records automatically.
-- Additive only.

CREATE TABLE water_intervention_types (
  name        TEXT PRIMARY KEY,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO water_intervention_types (name, sort_order) VALUES
  ('Rainwater Harvesting', 10), ('Water Treatment', 20), ('Wastewater Treatment', 30), ('STP', 40),
  ('Greywater Reuse', 50), ('Sewage Reuse', 60), ('Water Recycling', 70), ('Drinking Water Treatment', 80),
  ('Groundwater Management', 90), ('Stormwater Management', 100), ('Smart Water Monitoring', 110),
  ('Leak Detection', 120), ('Water Efficiency', 130), ('Landscaping Water Optimization', 140), ('Other', 999);

CREATE TABLE water_opportunities (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER REFERENCES projects(id),
  organization_id     INTEGER REFERENCES organizations(id),
  intervention_type   TEXT NOT NULL REFERENCES water_intervention_types(name) ON UPDATE CASCADE,
  potential           TEXT NOT NULL DEFAULT 'Unknown' CHECK (potential IN ('High', 'Medium', 'Low', 'Unknown')),
  reason              TEXT NOT NULL CHECK (btrim(reason) <> ''),   -- why this intervention may fit
  evidence            TEXT,                                          -- supporting facts / quotes
  source              TEXT,
  source_id           INTEGER REFERENCES sources(id),
  provenance          TEXT NOT NULL CHECK (provenance IN ('Verified', 'Unverified', 'Estimated', 'AI Inference')),
  confidence          TEXT NOT NULL DEFAULT 'Unknown' CHECK (confidence IN ('High', 'Medium', 'Low', 'Unknown')),
  origin              TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ai', 'import')),
  suggested_by_agent  TEXT,                                          -- e.g. 'water_intervention'
  status              TEXT NOT NULL DEFAULT 'suggested'
                      CHECK (status IN ('suggested', 'approved', 'rejected', 'pursuing', 'won', 'lost', 'dropped')),
  reviewed_by         INTEGER REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,
  owner_id            INTEGER REFERENCES users(id),
  crm_opportunity_id  INTEGER REFERENCES crm_opportunities(id),
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (project_id IS NOT NULL OR organization_id IS NOT NULL),
  -- AI output is always labelled as such.
  CHECK (origin <> 'ai' OR provenance = 'AI Inference'),
  -- Anything past 'suggested' needs a named human reviewer.
  CHECK (status = 'suggested' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  -- A CRM link only for reviewed, live opportunities.
  CHECK (crm_opportunity_id IS NULL OR status IN ('approved', 'pursuing', 'won', 'lost'))
);
CREATE INDEX water_opportunities_project_idx ON water_opportunities (project_id);
CREATE INDEX water_opportunities_org_idx ON water_opportunities (organization_id);
CREATE INDEX water_opportunities_status_idx ON water_opportunities (status);
-- No duplicate live opportunity for the same target and intervention.
CREATE UNIQUE INDEX water_opportunities_live_uq
  ON water_opportunities (coalesce(project_id, 0), coalesce(organization_id, 0), intervention_type)
  WHERE status NOT IN ('rejected', 'dropped', 'lost');
