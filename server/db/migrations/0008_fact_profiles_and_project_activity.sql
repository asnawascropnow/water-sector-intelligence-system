-- Migration 0008 — intelligence profiles for fact definitions + project activity timeline (WSIS Phase 5).
--
-- * fact_definitions.profiles lists the saved organization views (organization_views.key: architects,
--   developers, contractors, …) a fact is meant for. The Organization Details "Built Environment
--   Intelligence" section shows the facts of every profile whose view contains the organization's type,
--   so which facts appear for an architect vs a developer vs a contractor is configuration, not UI code.
-- * Adds the contractor facts (construction project types, specialties, MEP / water-system involvement,
--   water systems executed). Reference data only — no facts are created for any organization.
-- * project_activities is the append-only timeline for projects (create, edits, stakeholders, facts,
--   CRM links, merges), mirroring activities for organizations.
-- Additive only.

ALTER TABLE fact_definitions ADD COLUMN profiles TEXT[];

UPDATE fact_definitions SET profiles = '{architects}'
 WHERE key IN ('building_types', 'water_conservation_experience', 'greywater_experience', 'water_efficient_design', 'sustainable_architecture');
UPDATE fact_definitions SET profiles = '{architects,developers}'
 WHERE key IN ('green_building_experience', 'esg_focus', 'influence_level', 'influence_reason');
UPDATE fact_definitions SET profiles = '{architects,developers,contractors}'
 WHERE key IN ('rainwater_harvesting_experience', 'wastewater_reuse_experience', 'stp_experience', 'certifications', 'notable_projects');
UPDATE fact_definitions SET profiles = '{developers}'
 WHERE key IN ('developer_type', 'developer_project_types', 'active_project_count', 'project_locations', 'typical_project_scale',
               'sustainability_focus', 'water_requirements', 'existing_water_systems');

INSERT INTO fact_definitions (key, label, applies_to, value_type, allowed_values, multi_valued, type_groups, profiles, sort_order, description) VALUES
  ('contractor_project_types', 'Construction / project types', 'organization', 'enum',
     '["Residential","Commercial","Industrial","Institutional","Infrastructure","Hospitality","Healthcare","Mixed-use"]', TRUE, '{built_environment}', '{contractors}', 70, NULL),
  ('contractor_specialties', 'Specialties', 'organization', 'text', NULL, TRUE, '{built_environment}', '{contractors}', 71, 'e.g. civil works, plumbing, MEP, waterproofing'),
  ('mep_water_involvement', 'MEP / water-system involvement', 'organization', 'boolean', NULL, FALSE, '{built_environment}', '{contractors}', 72, 'Executes MEP or water-system packages on projects'),
  ('water_systems_executed', 'Water systems executed', 'organization', 'enum',
     '["Rainwater Harvesting","STP","Greywater Reuse","Wastewater Reuse","Water Recycling","Drinking Water Treatment","Stormwater Management","Smart Water Monitoring","Leak Detection","Water-efficient Fixtures"]', TRUE, '{built_environment}', '{contractors}', 73, 'Water-system execution experience');

CREATE TABLE project_activities (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  type        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id    INTEGER REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_activities_project_idx ON project_activities (project_id, occurred_at DESC);
