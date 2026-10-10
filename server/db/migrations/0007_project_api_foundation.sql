-- Migration 0007 — project API foundation (WSIS Phase 4).
--
-- * imports.kind records what a batch contains: 'organizations' (every existing import and every file
--   upload today), 'projects', or 'mixed'. Each staged record inside imports.records also carries an
--   entity_type ('organization' | 'project'); records staged before this migration have none and are
--   read as organizations.
-- * replaces_fact_id links a changed fact to the version it superseded, so editing a fact keeps the full
--   history (the old row is retired, never overwritten).
-- * updated_by on projects and project_organizations records who last changed them.
-- Additive only; existing rows keep their values (imports default to 'organizations').

ALTER TABLE imports
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'organizations' CHECK (kind IN ('organizations', 'projects', 'mixed'));

ALTER TABLE organization_facts ADD COLUMN replaces_fact_id INTEGER REFERENCES organization_facts(id);
ALTER TABLE project_facts      ADD COLUMN replaces_fact_id INTEGER REFERENCES project_facts(id);

ALTER TABLE projects              ADD COLUMN updated_by INTEGER REFERENCES users(id);
ALTER TABLE project_organizations ADD COLUMN updated_by INTEGER REFERENCES users(id);

CREATE INDEX projects_pincode_idx ON projects (pincode) WHERE merged_into IS NULL;
CREATE INDEX projects_type_idx ON projects (project_type) WHERE merged_into IS NULL;
