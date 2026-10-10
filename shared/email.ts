// Email outreach: constants and API types shared by the server and the React client.

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "active", "paused", "completed", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const ENROLLMENT_STATUSES = ["pending", "active", "paused", "replied", "completed", "unsubscribed", "bounced", "cancelled", "failed"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
/** Enrollments in these states can still receive email. */
export const LIVE_ENROLLMENT_STATUSES: EnrollmentStatus[] = ["pending", "active", "paused"];

export type SendMode = "dry_run" | "live";
export type MessageStatus = "sending" | "sent" | "failed_transient" | "failed_permanent" | "ambiguous";
export type SuppressionReason = "unsubscribed" | "hard_bounce" | "complaint" | "invalid" | "blocked" | "manual";

/** Template variables. `{{name|fallback}}` renders the fallback when the value is unknown. */
export const TEMPLATE_VARIABLES = [
  { key: "contact.first_name", label: "Contact first name" },
  { key: "contact.name", label: "Contact full name" },
  { key: "contact.designation", label: "Contact designation" },
  { key: "organization.name", label: "Organization name" },
  { key: "organization.org_type", label: "Organization type" },
  { key: "organization.sector", label: "Organization sector" },
  { key: "organization.area", label: "Organization area" },
  { key: "sender.name", label: "Sender name" },
  { key: "sender.company", label: "Sender company" },
] as const;

export interface SendWindow {
  start_hour: number; // 0–23, Asia/Kolkata
  end_hour: number; // 1–24, exclusive
  weekdays_only: boolean;
}

export interface CampaignSettings {
  send_window?: SendWindow | null; // null = send any time
  /** CRM statuses that stop a sequence for that organization. */
  stop_on_crm_statuses?: string[];
}

export interface EmailCampaign {
  id: number;
  name: string;
  description: string | null;
  status: CampaignStatus;
  send_mode: SendMode | null;
  settings: CampaignSettings;
  content_version: number;
  approved_version: number | null;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  scheduled_start_at: string | null;
  activated_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  // Aggregates
  audience: number;
  steps: number;
  sent: number;
  replied: number;
  meetings: number;
}

export interface SequenceStep {
  id: number;
  campaign_id: number;
  step_order: number;
  subject_template: string;
  text_template: string;
  html_template: string | null;
  delay_minutes: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Enrollment {
  id: number;
  campaign_id: number;
  contact_id: number | null;
  organization_id: number | null;
  organization_name: string | null;
  opportunity_id: number | null;
  email: string;
  recipient_name: string | null;
  current_step: number;
  status: EnrollmentStatus;
  next_send_at: string | null;
  attempt_count: number;
  last_error: string | null;
  stop_reason: string | null;
  enrolled_at: string;
  stopped_at: string | null;
  updated_at: string;
  pending_drafts: number;
  ambiguous_message: boolean;
}

export interface SendEvent {
  id: number;
  campaign_id: number | null;
  enrollment_id: number | null;
  step_id: number | null;
  step_order: number | null;
  message_id: number | null;
  event_type: string;
  attempt_number: number | null;
  provider: string | null;
  provider_message_id: string | null;
  email: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export interface EligibleContact {
  contact_id: number;
  name: string;
  designation: string | null;
  email: string | null;
  organization_id: number;
  organization_name: string;
  opportunity_id: number | null;
  crm_status: string | null;
  eligible: boolean;
  reasons: string[];
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Prospect list for recipient selection. Counts reflect the search / CRM-stage filters, not the eligibility filter. */
export interface EligibleContactsPage extends Page<EligibleContact> {
  eligible_total: number;
  ineligible_total: number;
  crm_contacts: number; // all contacts of CRM organizations, before any filter
  eligible_ids?: number[]; // every eligible contact id matching the filters (capped), for "select all eligible"
}

export interface CampaignAnalytics {
  enrolled: number;
  eligible_live: number; // enrollments still able to receive email
  messages_attempted: number; // logical emails attempted (one per recipient × step)
  accepted: number; // accepted by the provider (or recorded in dry-run)
  delivered: number;
  soft_bounced: number;
  hard_bounced: number;
  failed: number;
  ambiguous: number;
  replied: number;
  unsubscribed: number;
  meetings: number; // Meeting tasks completed / scheduled for enrolled organizations after enrollment
  reply_rate: number | null; // replied ÷ recipients with ≥1 accepted email
  bounce_rate: number | null; // hard bounces ÷ accepted
  unsubscribe_rate: number | null; // unsubscribed ÷ recipients with ≥1 accepted email
  recipients_contacted: number; // recipients with ≥1 accepted email
  by_step: { step_order: number; accepted: number; delivered: number; replied_after: number }[];
}

export interface EmailSystemStatus {
  mode: SendMode;
  provider: string;
  scheduler_enabled: boolean;
  scheduler_running: boolean;
  reply_detection: boolean;
  webhook_auth_configured: boolean;
  live_ready: boolean;
  live_problems: string[];
  sender: { name: string; email: string | null; company: string | null; name_is_default: boolean };
  test_recipients: string[]; // EMAIL_TEST_RECIPIENTS: allowed to receive test emails
  recipient_allowlist: string[]; // EMAIL_RECIPIENT_ALLOWLIST: when non-empty, every email must match
  limits: { daily_send_limit: number; max_recipients_per_campaign: number; batch_size: number; max_attempts: number };
  sent_today: number;
  can_approve: boolean;
  approver_roles: string[];
  ai_enabled: boolean;
}

export interface AiDraft {
  subject: string;
  text_body: string;
  facts_used: string[];
  hypotheses: string[];
  placeholders: string[];
  warnings: string[];
}

export interface TestRecipientStatus {
  email: string | null;
  authorized: boolean;
  via: "team_member" | "test_recipients" | null;
  reason: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  missing: string[];
  placeholders: string[];
}
