-- Migration 0002 — organization type catalog + sourced organization facts (WSIS Phase 2).
--
-- * organization_types becomes the database-backed catalog of organization categories, grouped into
--   water ecosystem / built environment / demand side / public sector / research & education /
--   civil society. The 12 MVP types keep their exact names so every existing organizations.org_type
--   value stays valid; any other value already present is preserved as an inactive "legacy" type.
-- * organizations.org_type gets a foreign key to the catalog (ON UPDATE CASCADE, so relabelling a
--   type later updates every organization in one statement).
-- * fact_definitions + organization_facts hold sourced, field-level intelligence (architect building
--   types, STP experience, influence level, developer project types, …). Nothing is backfilled:
--   "Unknown" simply means no fact row exists.
-- Additive only. Existing rows are not modified.

CREATE TABLE organization_type_groups (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO organization_type_groups (key, label, sort_order) VALUES
  ('water_ecosystem',    'Water ecosystem',          10),
  ('built_environment',  'Built environment',        20),
  ('demand_side',        'Water users / demand side', 30),
  ('public_sector',      'Public sector',            40),
  ('research_education', 'Research & education',     50),
  ('civil_society',      'Civil society & institutions', 60),
  ('other',              'Other',                    90);

CREATE TABLE organization_types (
  name         TEXT PRIMARY KEY,                    -- stored verbatim in organizations.org_type
  group_key    TEXT NOT NULL REFERENCES organization_type_groups(key),
  description  TEXT,
  map_color    TEXT CHECK (map_color IS NULL OR map_color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE,       -- inactive types stay valid for existing rows but are not offered for new ones
  is_builtin   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO organization_types (name, group_key, map_color, sort_order) VALUES
  -- MVP types (names unchanged)
  ('Manufacturing',                 'demand_side',        '#d9480f', 100),
  ('Industrial',                    'demand_side',        '#9c36b5', 110),
  ('IT / Technology',               'demand_side',        '#1971c2', 120),
  ('Hospital',                      'demand_side',        '#e03131', 130),
  ('Hotel',                         'demand_side',        '#f08c00', 140),
  ('Apartment',                     'demand_side',        '#5c7cfa', 150),
  ('Commercial',                    'demand_side',        '#a61e4d', 160),
  ('School',                        'research_education', '#2f9e44', 300),
  ('College / University',          'research_education', '#0c8599', 310),
  ('Institution',                   'civil_society',      '#66a80f', 410),
  ('Government',                    'public_sector',      '#495057', 200),
  ('Other',                         'other',              '#868e96', 999),
  -- Water ecosystem
  ('Water Technology Company',      'water_ecosystem',    '#0b7285', 10),
  ('Water Treatment Company',       'water_ecosystem',    '#1098ad', 11),
  ('STP/WTP Provider',              'water_ecosystem',    '#15aabf', 12),
  ('Wastewater Company',            'water_ecosystem',    '#3bc9db', 13),
  ('Water Consultant',              'water_ecosystem',    '#22b8cf', 14),
  -- Built environment
  ('Architect',                     'built_environment',  '#7048e8', 50),
  ('Architecture Firm',             'built_environment',  '#6741d9', 51),
  ('Builder',                       'built_environment',  '#e8590c', 52),
  ('Real Estate Developer',         'built_environment',  '#f76707', 53),
  ('Construction Company',          'built_environment',  '#c2255c', 54),
  ('Civil Contractor',              'built_environment',  '#d6336c', 55),
  ('MEP Consultant',                'built_environment',  '#5f3dc4', 56),
  ('Plumbing Consultant',           'built_environment',  '#4263eb', 57),
  ('Structural Consultant',         'built_environment',  '#364fc7', 58),
  ('Landscape Architect',           'built_environment',  '#37b24d', 59),
  ('Interior Designer',             'built_environment',  '#ae3ec9', 60),
  ('Project Management Consultant', 'built_environment',  '#862e9c', 61),
  ('Green Building Consultant',     'built_environment',  '#2b8a3e', 62),
  ('Facility Management Company',   'built_environment',  '#5c940d', 63),
  -- Public sector / research / civil society
  ('Utility',                       'public_sector',      '#343a40', 210),
  ('Research Institution',          'research_education', '#087f5b', 320),
  ('NGO / Foundation',              'civil_society',      '#74b816', 400);

-- Preserve any organization type already in use that is not in the catalog (legacy / hand-edited data).
INSERT INTO organization_types (name, group_key, sort_order, active, is_builtin, description)
SELECT DISTINCT o.org_type, 'other', 1000, FALSE, FALSE, 'Legacy type found in existing data during migration 0002'
  FROM organizations o
 WHERE NOT EXISTS (SELECT 1 FROM organization_types t WHERE t.name = o.org_type);

ALTER TABLE organizations
  ADD CONSTRAINT organizations_org_type_fkey FOREIGN KEY (org_type) REFERENCES organization_types(name) ON UPDATE CASCADE;

-- Catalog of fact keys usable on organizations (and, from migration 0003, projects).
CREATE TABLE fact_definitions (
  key              TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  applies_to       TEXT NOT NULL CHECK (applies_to IN ('organization', 'project')),
  value_type       TEXT NOT NULL CHECK (value_type IN ('text', 'boolean', 'number', 'level', 'enum')),
  allowed_values   JSONB CHECK (allowed_values IS NULL OR jsonb_typeof(allowed_values) = 'array'),
  multi_valued     BOOLEAN NOT NULL DEFAULT FALSE,  -- several active values allowed (e.g. building types)
  type_groups      TEXT[],                          -- organization type groups this fact is meant for; NULL = any
  unit             TEXT,
  description      TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (value_type <> 'enum' OR allowed_values IS NOT NULL)
);

INSERT INTO fact_definitions (key, label, applies_to, value_type, allowed_values, multi_valued, type_groups, sort_order, description) VALUES
  -- Architects / architecture firms
  ('building_types',                'Building types',                 'organization', 'enum',
     '["Residential","Commercial","Institutional","Industrial","Hospitality","Healthcare","Education","Government","Mixed-use"]', TRUE, '{built_environment}', 10, 'Building types the organization designs or builds'),
  ('green_building_experience',     'Green building experience',      'organization', 'boolean', NULL, FALSE, '{built_environment}', 20, NULL),
  ('water_conservation_experience', 'Water conservation experience',  'organization', 'boolean', NULL, FALSE, '{built_environment}', 21, NULL),
  ('rainwater_harvesting_experience','Rainwater harvesting experience','organization', 'boolean', NULL, FALSE, '{built_environment}', 22, NULL),
  ('wastewater_reuse_experience',   'Wastewater reuse experience',    'organization', 'boolean', NULL, FALSE, '{built_environment}', 23, NULL),
  ('stp_experience',                'STP experience',                 'organization', 'boolean', NULL, FALSE, '{built_environment}', 24, NULL),
  ('greywater_experience',          'Greywater experience',           'organization', 'boolean', NULL, FALSE, '{built_environment}', 25, NULL),
  ('water_efficient_design',        'Water-efficient design',         'organization', 'boolean', NULL, FALSE, '{built_environment}', 26, NULL),
  ('sustainable_architecture',      'Sustainable architecture focus', 'organization', 'boolean', NULL, FALSE, '{built_environment}', 27, NULL),
  ('esg_focus',                     'ESG / sustainability focus',     'organization', 'boolean', NULL, FALSE, NULL, 28, NULL),
  ('certifications',                'Certifications / rated projects','organization', 'text',    NULL, TRUE,  NULL, 30, 'e.g. IGBC, GRIHA, LEED rated work, as published'),
  ('notable_projects',              'Notable / relevant projects',    'organization', 'text',    NULL, TRUE,  '{built_environment}', 31, 'Free text until the project is recorded as a project'),
  ('influence_level',               'Influence level',                'organization', 'level',   '["High","Medium","Low"]', FALSE, '{built_environment}', 40, 'Influence over water decisions on projects'),
  ('influence_reason',              'Reason for influence assessment','organization', 'text',    NULL, FALSE, '{built_environment}', 41, NULL),
  -- Builders / developers
  ('developer_type',                'Developer type',                 'organization', 'text',    NULL, FALSE, '{built_environment}', 50, NULL),
  ('developer_project_types',       'Project types developed',        'organization', 'enum',
     '["Residential","Commercial","Township","Industrial","Hospitality","Institutional","Mixed-use"]', TRUE, '{built_environment}', 51, NULL),
  ('active_project_count',          'Active projects',                'organization', 'number',  NULL, FALSE, '{built_environment}', 52, NULL),
  ('project_locations',             'Project locations',              'organization', 'text',    NULL, TRUE,  '{built_environment}', 53, NULL),
  ('typical_project_scale',         'Typical project scale',          'organization', 'enum',    '["Small","Medium","Large","Very large"]', FALSE, '{built_environment}', 54, NULL),
  ('sustainability_focus',          'Sustainability focus',           'organization', 'text',    NULL, TRUE,  NULL, 55, NULL),
  ('existing_water_systems',        'Existing water systems',         'organization', 'enum',
     '["Rainwater Harvesting","STP","Greywater Reuse","Wastewater Reuse","Water Recycling","Drinking Water Treatment","Stormwater Management","Smart Water Monitoring","Leak Detection","Water-efficient Fixtures"]', TRUE, NULL, 60, NULL),
  ('water_requirements',            'Water requirements',             'organization', 'text',    NULL, TRUE,  NULL, 61, NULL);

-- Sourced organization facts. A fact is never deleted: replacing a single-valued fact or withdrawing
-- one sets retired_at, so the history of what was believed (and from where) is kept.
CREATE TABLE organization_facts (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id),
  fact_key         TEXT NOT NULL REFERENCES fact_definitions(key) ON UPDATE CASCADE,
  value            TEXT NOT NULL CHECK (btrim(value) <> ''),
  note             TEXT,
  source           TEXT,                               -- human-readable source label or URL
  source_id        INTEGER REFERENCES sources(id),
  provenance       TEXT NOT NULL CHECK (provenance IN ('Verified', 'Unverified', 'Estimated', 'AI Inference')),
  confidence       TEXT NOT NULL DEFAULT 'Unknown' CHECK (confidence IN ('High', 'Medium', 'Low', 'Unknown')),
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at       TIMESTAMPTZ,
  retired_by       INTEGER REFERENCES users(id),
  CHECK (provenance = 'Verified' OR source IS NOT NULL OR source_id IS NOT NULL)  -- unverified facts must say where they came from
);
CREATE INDEX organization_facts_org_idx ON organization_facts (organization_id) WHERE retired_at IS NULL;
-- The same value is recorded once per organization and key while active.
CREATE UNIQUE INDEX organization_facts_active_value_uq ON organization_facts (organization_id, fact_key, lower(value)) WHERE retired_at IS NULL;
