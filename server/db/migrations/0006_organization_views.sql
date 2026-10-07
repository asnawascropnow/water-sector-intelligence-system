-- Migration 0006 — saved Discover views over the organization type catalog (WSIS Phase 3).
--
-- A view is a named set of organization types (Architects, Developers, Contractors, Water Ecosystem).
-- The sidebar lists the views and the Organizations page applies their types as a filter, so which
-- types belong to which view is configuration in the database, not logic in the UI.
-- Members reference organization_types, so a view can only contain catalog types.
-- Additive only: no existing table or row is modified.

CREATE TABLE organization_views (
  key          TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label        TEXT NOT NULL,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE organization_view_types (
  view_key   TEXT NOT NULL REFERENCES organization_views(key) ON UPDATE CASCADE,
  type_name  TEXT NOT NULL REFERENCES organization_types(name) ON UPDATE CASCADE,
  PRIMARY KEY (view_key, type_name)
);

INSERT INTO organization_views (key, label, description, sort_order) VALUES
  ('architects',      'Architects',      'Architects and architecture firms',                                  10),
  ('developers',      'Developers',      'Builders, developers, construction and built-environment consultants', 20),
  ('contractors',     'Contractors',     'Construction companies and civil contractors',                      30),
  ('water_ecosystem', 'Water Ecosystem', 'Water technology, treatment and consulting firms, utilities, government, NGOs and research', 40);

INSERT INTO organization_view_types (view_key, type_name) VALUES
  ('architects', 'Architect'),
  ('architects', 'Architecture Firm'),

  ('developers', 'Builder'),
  ('developers', 'Real Estate Developer'),
  ('developers', 'Construction Company'),
  ('developers', 'Civil Contractor'),
  ('developers', 'Project Management Consultant'),
  ('developers', 'MEP Consultant'),
  ('developers', 'Plumbing Consultant'),
  ('developers', 'Structural Consultant'),
  ('developers', 'Landscape Architect'),
  ('developers', 'Interior Designer'),
  ('developers', 'Green Building Consultant'),
  ('developers', 'Facility Management Company'),

  ('contractors', 'Construction Company'),
  ('contractors', 'Civil Contractor'),

  ('water_ecosystem', 'Water Technology Company'),
  ('water_ecosystem', 'Water Treatment Company'),
  ('water_ecosystem', 'STP/WTP Provider'),
  ('water_ecosystem', 'Wastewater Company'),
  ('water_ecosystem', 'Water Consultant'),
  ('water_ecosystem', 'Government'),
  ('water_ecosystem', 'Utility'),
  ('water_ecosystem', 'NGO / Foundation'),
  ('water_ecosystem', 'Research Institution');
