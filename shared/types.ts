import type {
  CallStatus,
  CrmStatus,
  DataConfidence,
  OrgType,
  PilotStatus,
  Potential,
  ProposalStatus,
  Provenance,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "./constants";

export interface User {
  id: number;
  name: string;
  email: string | null;
  role: string;
  active: boolean;
}

export interface FieldSource {
  provenance: Provenance;
  source?: string | null; // human-readable source label or URL
}

export interface WaterInfo {
  text: string;
  provenance: Provenance;
  source: string | null;
}

export interface Intelligence {
  potential?: Potential;
  reasons?: string[];
  confidence?: DataConfidence;
  provenance?: Provenance;
  assessedAt?: string;
  waterInfo?: WaterInfo[];
}

export interface OrganizationInput {
  name: string;
  org_type?: OrgType | null;
  sector?: string | null;
  address?: string | null;
  area?: string | null;
  city?: string | null;
  pincode?: string | null;
  lat?: number | null;
  lng?: number | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_name?: string | null;
  contact_designation?: string | null;
}

export interface Organization {
  id: number;
  name: string;
  org_type: OrgType;
  sector: string | null;
  address: string | null;
  area: string | null;
  city: string;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  source_id: number | null;
  source_label: string | null;
  data_confidence: DataConfidence;
  field_sources: Record<string, FieldSource>;
  intelligence: Intelligence;
  created_at: string;
  updated_at: string;
  // CRM summary (null if not in CRM)
  opportunity_id: number | null;
  crm_status: CrmStatus | null;
  owner_name: string | null;
}

export interface Contact {
  id: number;
  organization_id: number;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  source_label: string | null;
}

export interface Opportunity {
  id: number;
  organization_id: number;
  organization_name: string;
  org_type: OrgType;
  area: string | null;
  potential: Potential | null;
  owner_id: number | null;
  owner_name: string | null;
  status: CrmStatus;
  contact_id: number | null;
  contact_name: string | null;
  last_contact_at: string | null;
  next_follow_up: string | null;
  notes: string | null;
  call_status: CallStatus;
  proposal_status: ProposalStatus;
  proposal_sent_at: string | null;
  pilot_status: PilotStatus;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: number;
  organization_id: number;
  opportunity_id: number | null;
  type: string;
  summary: string;
  details: Record<string, unknown>;
  actor_id: number | null;
  actor_name: string | null;
  occurred_at: string;
}

export interface Task {
  id: number;
  organization_id: number | null;
  organization_name: string | null;
  opportunity_id: number | null;
  assigned_to: number | null;
  assigned_name: string | null;
  title: string;
  task_type: TaskType;
  due_date: string | null; // YYYY-MM-DD
  priority: TaskPriority;
  status: TaskStatus;
  created_at: string;
  completed_at: string | null;
  overdue: boolean;
}

export type DuplicateMatchLevel = "existing" | "possible_duplicate" | "new";

export interface DuplicateCandidate {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  score: number;
  reasons: string[];
}

export interface DuplicateResult {
  level: DuplicateMatchLevel;
  candidates: DuplicateCandidate[];
}

export type ImportRecordStatus = "pending" | "approved" | "merged" | "rejected";

export interface ImportRecord {
  index: number;
  data: OrganizationInput;
  field_sources: Record<string, FieldSource>;
  warnings: string[];
  duplicate: DuplicateResult;
  status: ImportRecordStatus;
  result_org_id: number | null;
}

export interface ImportSummary {
  id: number;
  filename: string;
  file_type: string;
  status: "processing" | "review" | "completed" | "failed";
  extraction_method: string | null;
  uploaded_by_name: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  stats: { found: number; new: number; existing: number; possible_duplicates: number; pending: number; approved: number; merged: number; rejected: number };
}

export interface ImportDetail extends ImportSummary {
  records: ImportRecord[];
}

export interface Recommendation {
  id: number;
  agent: "opportunity" | "next_action" | "enrichment" | "import_review";
  organization_id: number | null;
  organization_name: string | null;
  opportunity_id: number | null;
  action_type: string;
  title: string;
  reason: string;
  priority: TaskPriority;
  assigned_to: number | null;
  assigned_name: string | null;
  status: "open" | "done" | "dismissed";
  payload: Record<string, unknown>;
  created_at: string;
}

export interface DailyBrief {
  date: string;
  counts: {
    followUpsDue: number;
    callsToday: number;
    proposalsAwaitingResponse: number;
    newOpportunities: number;
    unassignedOpportunities: number;
    overdueFollowUps: number;
    pendingImportRecords: number;
  };
  recommendations: Recommendation[];
}

export interface DashboardSummary {
  totalOrganizations: number;
  newOrganizations: number; // added in the last 7 days
  crmOpportunities: number;
  activeOpportunities: number;
  proposalsSent: number;
  pilots: number;
  overdueFollowUps: number;
  pipeline: { status: CrmStatus; count: number }[];
}

export interface SystemInfo {
  database: "postgres" | "pglite";
  geocoder: "nominatim" | "none";
  llm: boolean;
  llmModel: string | null;
}
