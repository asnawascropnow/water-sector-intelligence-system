-- Migration 0011 — Email outreach (campaigns → sequence steps → enrollments → messages → events).
-- See docs/email-automation.md. All timestamps are TIMESTAMPTZ (UTC); send windows are interpreted in Asia/Kolkata.
-- Additive only. IF NOT EXISTS keeps it safe on local databases created by the pre-migration email branch,
-- whose schema.sql already created these tables.

CREATE TABLE IF NOT EXISTS email_campaigns (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled')),
  -- 'dry_run' or 'live', fixed when the campaign is first activated. The worker only sends a campaign whose
  -- mode matches the server's current mode, so a dry-run campaign can never start sending real email.
  send_mode          TEXT CHECK (send_mode IN ('dry_run', 'live')),
  settings           JSONB NOT NULL DEFAULT '{}'::jsonb, -- send window, stop rules
  content_version    INTEGER NOT NULL DEFAULT 1,          -- bumped on every content change; invalidates approval
  approved_version   INTEGER,
  approved_by        INTEGER REFERENCES users(id),
  approved_at        TIMESTAMPTZ,
  scheduled_start_at TIMESTAMPTZ,
  activated_at       TIMESTAMPTZ,
  paused_at          TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  created_by         INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_campaigns_status_idx ON email_campaigns (status);

-- delay_minutes: step 1 → after the enrollment starts (activation or later enrollment);
-- step N > 1 → after the previous step was actually sent. Day 1 / Day 4 / Day 8 = 0, 3 days, 4 days.
CREATE TABLE IF NOT EXISTS email_sequence_steps (
  id               SERIAL PRIMARY KEY,
  campaign_id      INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  step_order       INTEGER NOT NULL CHECK (step_order > 0),
  subject_template TEXT NOT NULL,
  text_template    TEXT NOT NULL,
  html_template    TEXT, -- optional; generated from text_template when empty
  delay_minutes    INTEGER NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, step_order)
);

CREATE TABLE IF NOT EXISTS email_sequence_enrollments (
  id               SERIAL PRIMARY KEY,
  campaign_id      INTEGER NOT NULL REFERENCES email_campaigns(id),
  contact_id       INTEGER REFERENCES contacts(id),
  organization_id  INTEGER REFERENCES organizations(id),
  opportunity_id   INTEGER REFERENCES crm_opportunities(id),
  email            TEXT NOT NULL,      -- normalized (lower-case) snapshot at enrollment
  recipient_name   TEXT,
  current_step     INTEGER NOT NULL DEFAULT 0, -- step_order of the last step sent (0 = none yet)
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'replied', 'completed', 'unsubscribed', 'bounced', 'cancelled', 'failed')),
  next_send_at     TIMESTAMPTZ,
  attempt_count    INTEGER NOT NULL DEFAULT 0, -- attempts for the current step
  claim_token      TEXT,                       -- worker lease
  claimed_at       TIMESTAMPTZ,
  last_error       TEXT,
  stop_reason      TEXT,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  reply_token      TEXT NOT NULL UNIQUE,
  enrolled_by      INTEGER REFERENCES users(id),
  enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One live enrollment per contact (and per address) per campaign.
CREATE UNIQUE INDEX IF NOT EXISTS email_enrollments_live_contact_uq ON email_sequence_enrollments (campaign_id, contact_id) WHERE status IN ('pending', 'active', 'paused');
CREATE UNIQUE INDEX IF NOT EXISTS email_enrollments_live_email_uq ON email_sequence_enrollments (campaign_id, email) WHERE status IN ('pending', 'active', 'paused');
CREATE INDEX IF NOT EXISTS email_enrollments_due_idx ON email_sequence_enrollments (status, next_send_at);
CREATE INDEX IF NOT EXISTS email_enrollments_email_idx ON email_sequence_enrollments (email);

-- One row per logical email (enrollment × step). The unique key is the duplicate-send guard.
CREATE TABLE IF NOT EXISTS email_messages (
  id                  SERIAL PRIMARY KEY,
  campaign_id         INTEGER NOT NULL REFERENCES email_campaigns(id),
  enrollment_id       INTEGER NOT NULL REFERENCES email_sequence_enrollments(id),
  step_id             INTEGER NOT NULL REFERENCES email_sequence_steps(id),
  status              TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed_transient', 'failed_permanent', 'ambiguous')),
  send_mode           TEXT NOT NULL CHECK (send_mode IN ('dry_run', 'live')),
  attempts            INTEGER NOT NULL DEFAULT 1,
  provider            TEXT NOT NULL,
  provider_message_id TEXT,
  subject             TEXT NOT NULL,
  last_error          TEXT,
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, step_id)
);
CREATE INDEX IF NOT EXISTS email_messages_provider_id_idx ON email_messages (provider_message_id);
CREATE INDEX IF NOT EXISTS email_messages_created_idx ON email_messages (send_mode, created_at);

-- Send attempts and provider/webhook events. dedupe_key makes webhook processing idempotent.
CREATE TABLE IF NOT EXISTS email_send_events (
  id                  SERIAL PRIMARY KEY,
  campaign_id         INTEGER REFERENCES email_campaigns(id),
  enrollment_id       INTEGER REFERENCES email_sequence_enrollments(id),
  step_id             INTEGER REFERENCES email_sequence_steps(id),
  message_id          INTEGER REFERENCES email_messages(id),
  event_type          TEXT NOT NULL,
  attempt_number      INTEGER,
  provider            TEXT,
  provider_message_id TEXT,
  email               TEXT,
  dedupe_key          TEXT UNIQUE,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb, -- sanitized; never contains credentials
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_send_events_campaign_idx ON email_send_events (campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS email_send_events_enrollment_idx ON email_send_events (enrollment_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS email_suppressions (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE, -- normalized lower-case
  reason      TEXT NOT NULL CHECK (reason IN ('unsubscribed', 'hard_bounce', 'complaint', 'invalid', 'blocked', 'manual')),
  source      TEXT NOT NULL,        -- 'unsubscribe_link', 'brevo_webhook', 'manual:<user>' …
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-recipient drafts (AI or manual) that override a step's template once a person approves them.
CREATE TABLE IF NOT EXISTS email_personalized_drafts (
  id             SERIAL PRIMARY KEY,
  enrollment_id  INTEGER NOT NULL REFERENCES email_sequence_enrollments(id),
  step_id        INTEGER NOT NULL REFERENCES email_sequence_steps(id) ON DELETE CASCADE,
  subject        TEXT NOT NULL,
  text_body      TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('ai', 'manual')),
  status         TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  notes          JSONB NOT NULL DEFAULT '{}'::jsonb, -- facts used, hypotheses, warnings
  created_by     INTEGER REFERENCES users(id),
  reviewed_by    INTEGER REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, step_id)
);
