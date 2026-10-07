-- Migration 0005 — configurable CRM pipelines and CRM schema preparation (WSIS Phase 2).
--
-- * pipelines / pipeline_stages replace the hard-coded stage CHECK. Two pipelines are seeded:
--     relationship — the existing MVP pipeline, unchanged (New → … → Converted, plus the
--                    Not Interested / Lost / Nurture outcomes). It is the default.
--     project      — Identified → Research → Contacted → Meeting → Technical Discussion →
--                    Proposal → Negotiation → Pilot / Project → Won.
-- * Each stage carries a kind (open / won / lost) and an optional milestone tag (contacted, call,
--   meeting, proposal, pilot, won) so automatic stage advancement and agent rules can work across
--   pipelines without knowing stage names.
-- * crm_opportunities gains pipeline, opportunity_type, optional project and title. Existing rows land
--   in the relationship pipeline as type 'Customer' (the MVP CRM tracked prospective customers) with
--   their status untouched.
-- * The one-opportunity-per-organization UNIQUE constraint is dropped so an organization can hold
--   several opportunities (different types / projects). The API keeps its existing one-per-organization
--   check until the multi-opportunity CRM is built (Phase 7), so behaviour does not change yet.
-- * status is now validated by a composite foreign key (pipeline, status) → pipeline_stages, which is
--   equivalent to the old CHECK for the relationship pipeline.

CREATE TABLE pipelines (
  key          TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  description  TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX pipelines_single_default_uq ON pipelines (is_default) WHERE is_default;

INSERT INTO pipelines (key, label, description, is_default, sort_order) VALUES
  ('relationship', 'Organization / Relationship', 'Customers, partners and other organization relationships', TRUE, 10),
  ('project',      'Project Opportunity',         'Water interventions on a specific construction project',   FALSE, 20);

CREATE TABLE pipeline_stages (
  id          SERIAL PRIMARY KEY,
  pipeline    TEXT NOT NULL REFERENCES pipelines(key) ON UPDATE CASCADE,
  name        TEXT NOT NULL CHECK (btrim(name) <> ''),
  sort_order  INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  is_outcome  BOOLEAN NOT NULL DEFAULT FALSE,   -- shown beside the main track (Not Interested, Lost, Nurture)
  milestone   TEXT CHECK (milestone IN ('contacted', 'call', 'meeting', 'proposal', 'pilot', 'won')),
  UNIQUE (pipeline, name),
  UNIQUE (pipeline, sort_order)
);
-- One stage per milestone per pipeline, and exactly the 'won' milestone on a 'won' stage.
CREATE UNIQUE INDEX pipeline_stages_milestone_uq ON pipeline_stages (pipeline, milestone) WHERE milestone IS NOT NULL;
ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_won_milestone_check CHECK ((milestone IS NOT DISTINCT FROM 'won') = (kind = 'won'));

INSERT INTO pipeline_stages (pipeline, name, sort_order, kind, is_outcome, milestone) VALUES
  ('relationship', 'New',            10, 'open', FALSE, NULL),
  ('relationship', 'Contacted',      20, 'open', FALSE, 'contacted'),
  ('relationship', 'Call',           30, 'open', FALSE, 'call'),
  ('relationship', 'Proposal Sent',  40, 'open', FALSE, 'proposal'),
  ('relationship', 'Follow-up',      50, 'open', FALSE, NULL),
  ('relationship', 'Pilot',          60, 'open', FALSE, 'pilot'),
  ('relationship', 'Converted',      70, 'won',  FALSE, 'won'),
  ('relationship', 'Not Interested', 80, 'lost', TRUE,  NULL),
  ('relationship', 'Lost',           90, 'lost', TRUE,  NULL),
  ('relationship', 'Nurture',       100, 'open', TRUE,  NULL),
  ('project', 'Identified',            10, 'open', FALSE, NULL),
  ('project', 'Research',              20, 'open', FALSE, NULL),
  ('project', 'Contacted',             30, 'open', FALSE, 'contacted'),
  ('project', 'Meeting',               40, 'open', FALSE, 'meeting'),
  ('project', 'Technical Discussion',  50, 'open', FALSE, NULL),
  ('project', 'Proposal',              60, 'open', FALSE, 'proposal'),
  ('project', 'Negotiation',           70, 'open', FALSE, NULL),
  ('project', 'Pilot / Project',       80, 'open', FALSE, 'pilot'),
  ('project', 'Won',                   90, 'won',  FALSE, 'won');

CREATE TABLE opportunity_types (
  name              TEXT PRIMARY KEY,
  default_pipeline  TEXT NOT NULL REFERENCES pipelines(key) ON UPDATE CASCADE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO opportunity_types (name, default_pipeline, sort_order) VALUES
  ('Customer',                'relationship', 10),
  ('Pilot',                   'relationship', 20),
  ('Partnership',             'relationship', 30),
  ('Architect Partner',       'relationship', 40),
  ('Developer Relationship',  'relationship', 50),
  ('Contractor Relationship', 'relationship', 60),
  ('Technology Partnership',  'relationship', 70),
  ('Channel Partner',         'relationship', 80),
  ('Project Opportunity',     'project',      90),
  ('Other',                   'relationship', 999);

-- CRM preparation. Defaults make every existing row (and every insert by the current API) a
-- relationship-pipeline Customer opportunity with no project, exactly as before.
ALTER TABLE crm_opportunities
  ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'relationship' REFERENCES pipelines(key) ON UPDATE CASCADE,
  ADD COLUMN opportunity_type TEXT NOT NULL DEFAULT 'Customer' REFERENCES opportunity_types(name) ON UPDATE CASCADE,
  ADD COLUMN project_id INTEGER REFERENCES projects(id),
  ADD COLUMN title TEXT;

ALTER TABLE crm_opportunities DROP CONSTRAINT IF EXISTS crm_opportunities_status_check;
ALTER TABLE crm_opportunities
  ADD CONSTRAINT crm_opportunities_stage_fkey FOREIGN KEY (pipeline, status)
      REFERENCES pipeline_stages (pipeline, name) ON UPDATE CASCADE;

ALTER TABLE crm_opportunities DROP CONSTRAINT IF EXISTS crm_opportunities_organization_id_key;
CREATE INDEX crm_opportunities_org_idx ON crm_opportunities (organization_id);
CREATE INDEX crm_opportunities_project_idx ON crm_opportunities (project_id) WHERE project_id IS NOT NULL;
-- No duplicate *open* opportunity of the same type for the same organization and project.
CREATE UNIQUE INDEX crm_opportunities_open_uq
  ON crm_opportunities (organization_id, opportunity_type, coalesce(project_id, 0))
  WHERE status NOT IN ('Converted', 'Not Interested', 'Lost', 'Won');
