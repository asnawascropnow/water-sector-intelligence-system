-- Migration 0001 — baseline: the Bengaluru Water Intelligence & CRM MVP schema (PostgreSQL + PostGIS).
--
-- This is the schema that earlier versions created directly on every start. It stays fully
-- idempotent (IF NOT EXISTS everywhere) so that databases created before the migration runner
-- existed are adopted safely: running it there changes nothing and simply records version 0001.
--
-- Applied migrations are immutable. Never edit this file; add a new numbered migration instead.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  role        TEXT NOT NULL DEFAULT 'member',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Where a piece of data came from (file upload, manual entry, website, geocoder, AI inference…)
CREATE TABLE IF NOT EXISTS sources (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('manual', 'file_upload', 'api', 'website', 'geocoder', 'ai_inference', 'seed')),
  label       TEXT NOT NULL,
  url         TEXT,
  import_id   INTEGER,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imports (
  id                SERIAL PRIMARY KEY,
  filename          TEXT NOT NULL,
  file_type         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'review', 'completed', 'failed')),
  extraction_method TEXT,
  records           JSONB NOT NULL DEFAULT '[]'::jsonb, -- staged records awaiting human review
  error             TEXT,
  uploaded_by       INTEGER REFERENCES users(id),
  source_id         INTEGER REFERENCES sources(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS organizations (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  normalized_name  TEXT NOT NULL,
  org_type         TEXT NOT NULL DEFAULT 'Other',
  sector           TEXT,
  address          TEXT,
  area             TEXT,
  city             TEXT NOT NULL DEFAULT 'Bengaluru',
  pincode          TEXT,
  geom             geography(Point, 4326),
  website          TEXT,
  phone            TEXT,
  email            TEXT,
  source_id        INTEGER REFERENCES sources(id),
  data_confidence  TEXT NOT NULL DEFAULT 'Unknown' CHECK (data_confidence IN ('High', 'Medium', 'Low', 'Unknown')),
  field_sources    JSONB NOT NULL DEFAULT '{}'::jsonb, -- per-field provenance
  intelligence     JSONB NOT NULL DEFAULT '{}'::jsonb, -- potential, reasons, water info (all labelled)
  merged_into      INTEGER REFERENCES organizations(id), -- set when merged into another record (Rule 4)
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organizations_geom_idx ON organizations USING GIST (geom);
CREATE INDEX IF NOT EXISTS organizations_normalized_name_idx ON organizations (normalized_name);
CREATE INDEX IF NOT EXISTS organizations_type_idx ON organizations (org_type);

CREATE TABLE IF NOT EXISTS contacts (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id),
  name             TEXT NOT NULL,
  designation      TEXT,
  phone            TEXT,
  email            TEXT,
  is_primary       BOOLEAN NOT NULL DEFAULT FALSE,
  source_id        INTEGER REFERENCES sources(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_org_idx ON contacts (organization_id);

-- Organization ≠ CRM opportunity (Rule 5). At most one opportunity per organization.
CREATE TABLE IF NOT EXISTS crm_opportunities (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER NOT NULL UNIQUE REFERENCES organizations(id),
  owner_id         INTEGER REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Contacted', 'Call', 'Proposal Sent', 'Follow-up', 'Pilot', 'Converted', 'Not Interested', 'Lost', 'Nurture')),
  contact_id       INTEGER REFERENCES contacts(id),
  last_contact_at  TIMESTAMPTZ,
  next_follow_up   DATE,
  notes            TEXT,
  call_status      TEXT NOT NULL DEFAULT 'Not Started' CHECK (call_status IN ('Not Started', 'Contact Attempted', 'Connected', 'No Response', 'Call Scheduled', 'Call Completed')),
  proposal_status  TEXT NOT NULL DEFAULT 'Not Started' CHECK (proposal_status IN ('Not Started', 'Drafting', 'Sent', 'Accepted', 'Rejected')),
  proposal_sent_at TIMESTAMPTZ,
  pilot_status     TEXT NOT NULL DEFAULT 'Not Started' CHECK (pilot_status IN ('Not Started', 'Planned', 'In Progress', 'Completed', 'Cancelled')),
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only timeline. Rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS activities (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id),
  opportunity_id   INTEGER REFERENCES crm_opportunities(id),
  type             TEXT NOT NULL,
  summary          TEXT NOT NULL,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id         INTEGER REFERENCES users(id),
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_org_idx ON activities (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activities_opp_idx ON activities (opportunity_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER REFERENCES organizations(id),
  opportunity_id   INTEGER REFERENCES crm_opportunities(id),
  assigned_to      INTEGER REFERENCES users(id),
  title            TEXT NOT NULL,
  task_type        TEXT NOT NULL DEFAULT 'Follow-up' CHECK (task_type IN ('Follow-up', 'Call', 'Proposal', 'Meeting', 'Other')),
  due_date         DATE,
  priority         TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High', 'Medium', 'Low')),
  status           TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Done', 'Cancelled')),
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks (status, due_date);

CREATE TABLE IF NOT EXISTS agent_recommendations (
  id               SERIAL PRIMARY KEY,
  agent            TEXT NOT NULL CHECK (agent IN ('opportunity', 'next_action', 'enrichment', 'import_review')),
  dedupe_key       TEXT NOT NULL UNIQUE,
  organization_id  INTEGER REFERENCES organizations(id),
  opportunity_id   INTEGER REFERENCES crm_opportunities(id),
  action_type      TEXT NOT NULL,
  title            TEXT NOT NULL,
  reason           TEXT NOT NULL,
  priority         TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High', 'Medium', 'Low')),
  assigned_to      INTEGER REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  refreshed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_recommendations_status_idx ON agent_recommendations (status, agent);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id),
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  action      TEXT NOT NULL,
  changes     JSONB NOT NULL DEFAULT '{}'::jsonb,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
