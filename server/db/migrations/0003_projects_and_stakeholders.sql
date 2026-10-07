-- Migration 0003 — projects as a first-class entity, project facts, and project ↔ organization
-- stakeholder links (WSIS Phase 2).
--
-- * An organization is not a project. A developer, architect or contractor can be linked to many
--   projects, and a project can have many organizations, each in one or more roles.
-- * projects mirrors organizations: normalised name for duplicate checks, PostGIS point,
--   field-level provenance, data confidence, merge pointer (Rule 4: one record per real project).
-- * project_facts holds sourced water / sustainability intelligence. Nothing is backfilled.
-- Additive only: no existing table or row is modified.

CREATE TABLE project_types (
  name        TEXT PRIMARY KEY,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO project_types (name, sort_order) VALUES
  ('Residential', 10), ('Commercial', 20), ('Mixed-use', 30), ('Township', 40), ('Institutional', 50),
  ('Industrial', 60), ('Hospitality', 70), ('Healthcare', 80), ('Education', 90), ('Government', 100),
  ('Infrastructure', 110), ('Other', 999);

CREATE TABLE stakeholder_roles (
  name         TEXT PRIMARY KEY,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO stakeholder_roles (name, sort_order) VALUES
  ('Developer', 10), ('Owner', 20), ('Architect', 30), ('Landscape Architect', 35), ('Contractor', 40),
  ('MEP Consultant', 50), ('Plumbing Consultant', 60), ('Structural Consultant', 70),
  ('Green Building Consultant', 75), ('Project Manager', 80), ('Operator', 90),
  ('Technology Provider', 100), ('Other', 999);

CREATE TABLE projects (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL CHECK (btrim(name) <> ''),
  normalized_name    TEXT NOT NULL,
  project_type       TEXT REFERENCES project_types(name) ON UPDATE CASCADE,   -- NULL = Unknown
  description        TEXT,
  address            TEXT,
  area               TEXT,
  city               TEXT NOT NULL DEFAULT 'Bengaluru',
  pincode            TEXT CHECK (pincode IS NULL OR pincode ~ '^[0-9]{6}$'),
  geom               geography(Point, 4326),
  website            TEXT,
  lifecycle_stage    TEXT NOT NULL DEFAULT 'Unknown'
                     CHECK (lifecycle_stage IN ('Concept', 'Design', 'Approval', 'Tender', 'Construction', 'Commissioning', 'Completed', 'Operations', 'Unknown')),
  scale              TEXT NOT NULL DEFAULT 'Unknown' CHECK (scale IN ('Small', 'Medium', 'Large', 'Very large', 'Unknown')),
  built_up_area_sqft NUMERIC CHECK (built_up_area_sqft IS NULL OR built_up_area_sqft > 0),
  building_count     INTEGER CHECK (building_count IS NULL OR building_count > 0),
  unit_count         INTEGER CHECK (unit_count IS NULL OR unit_count > 0),
  source_id          INTEGER REFERENCES sources(id),
  data_confidence    TEXT NOT NULL DEFAULT 'Unknown' CHECK (data_confidence IN ('High', 'Medium', 'Low', 'Unknown')),
  field_sources      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- per-field provenance, same shape as organizations.field_sources
  intelligence       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- agent output, always labelled
  notes              TEXT,
  merged_into        INTEGER REFERENCES projects(id),
  created_by         INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (merged_into IS NULL OR merged_into <> id)
);
CREATE INDEX projects_geom_idx ON projects USING GIST (geom);
CREATE INDEX projects_normalized_name_idx ON projects (normalized_name);
CREATE INDEX projects_stage_idx ON projects (lifecycle_stage) WHERE merged_into IS NULL;

-- Project facts: same rules as organization_facts (sourced, labelled, never deleted — retired instead).
CREATE TABLE project_facts (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id),
  fact_key     TEXT NOT NULL REFERENCES fact_definitions(key) ON UPDATE CASCADE,
  value        TEXT NOT NULL CHECK (btrim(value) <> ''),
  note         TEXT,
  source       TEXT,
  source_id    INTEGER REFERENCES sources(id),
  provenance   TEXT NOT NULL CHECK (provenance IN ('Verified', 'Unverified', 'Estimated', 'AI Inference')),
  confidence   TEXT NOT NULL DEFAULT 'Unknown' CHECK (confidence IN ('High', 'Medium', 'Low', 'Unknown')),
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at   TIMESTAMPTZ,
  retired_by   INTEGER REFERENCES users(id),
  CHECK (provenance = 'Verified' OR source IS NOT NULL OR source_id IS NOT NULL)
);
CREATE INDEX project_facts_project_idx ON project_facts (project_id) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX project_facts_active_value_uq ON project_facts (project_id, fact_key, lower(value)) WHERE retired_at IS NULL;

INSERT INTO fact_definitions (key, label, applies_to, value_type, allowed_values, multi_valued, unit, sort_order, description) VALUES
  ('water_requirement',        'Water requirement',            'project', 'number', NULL, FALSE, 'KLD', 10, 'Daily water demand'),
  ('wastewater_generation',    'Wastewater generation',        'project', 'number', NULL, FALSE, 'KLD', 11, NULL),
  ('water_sources',            'Water sources',                'project', 'enum',
     '["Groundwater","Municipal Supply","Tanker","Rainwater","Recycled Water","Other"]', TRUE, NULL, 20, NULL),
  ('project_water_systems',    'Existing / planned water systems', 'project', 'enum',
     '["Rainwater Harvesting","STP","Greywater Reuse","Wastewater Reuse","Water Recycling","Drinking Water Treatment","Stormwater Management","Smart Water Monitoring","Leak Detection","Water-efficient Fixtures"]', TRUE, NULL, 21, NULL),
  ('stp_capacity',             'STP capacity',                 'project', 'number', NULL, FALSE, 'KLD', 22, NULL),
  ('sustainability_objectives','Sustainability objectives',    'project', 'text',   NULL, TRUE,  NULL, 30, NULL),
  ('green_certification',      'Green certification (target or achieved)', 'project', 'text', NULL, TRUE, NULL, 31, 'e.g. IGBC Gold, GRIHA 4-star, as published'),
  ('water_notes',              'Other water information',      'project', 'text',   NULL, TRUE,  NULL, 40, NULL);

-- Stakeholders: many organizations per project, many projects per organization, one row per role.
CREATE TABLE project_organizations (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES projects(id),
  organization_id  INTEGER NOT NULL REFERENCES organizations(id),
  role             TEXT NOT NULL REFERENCES stakeholder_roles(name) ON UPDATE CASCADE,
  is_primary       BOOLEAN NOT NULL DEFAULT FALSE,     -- e.g. the lead architect among several
  source           TEXT,
  source_id        INTEGER REFERENCES sources(id),
  provenance       TEXT NOT NULL CHECK (provenance IN ('Verified', 'Unverified', 'Estimated', 'AI Inference')),
  confidence       TEXT NOT NULL DEFAULT 'Unknown' CHECK (confidence IN ('High', 'Medium', 'Low', 'Unknown')),
  notes            TEXT,
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (provenance = 'Verified' OR source IS NOT NULL OR source_id IS NOT NULL),
  UNIQUE (project_id, organization_id, role)            -- an organization holds a given role on a project once
);
-- At most one primary organization per role on a project.
CREATE UNIQUE INDEX project_organizations_primary_uq ON project_organizations (project_id, role) WHERE is_primary;
CREATE INDEX project_organizations_org_idx ON project_organizations (organization_id);
