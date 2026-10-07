import type {
  FactProvenance,
  LifecycleStage,
  ProjectScale,
  WaterOpportunityOutcome,
  WaterOpportunityStatus,
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
  opportunity_id: number | null; // the organization's relationship opportunity (never a project opportunity)
  crm_status: CrmStatus | null; // stage of that relationship opportunity
  owner_name: string | null;
  crm_opportunity_count: number;
  /** Project-pipeline opportunities with this organization as customer. */
  project_opportunity_count?: number;
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
  /** Stage name — valid for the opportunity's pipeline (pipeline_stages). */
  status: string;
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
  pipeline: string;
  opportunity_type: string;
  project_id: number | null;
  title: string | null;
  /** The team's rating ("team") or the organization's AI-inferred potential ("ai"); null when neither exists. */
  potential_source: "team" | "ai" | null;
  stage_kind: "open" | "won" | "lost";
  stage_is_outcome: boolean;
  stage_order: number;
  project_name: string | null;
  project_lifecycle_stage: string | null;
  project_area: string | null;
  /** The customer organization's role(s) on the project. */
  stakeholder_roles: string[] | null;
  source_water_opportunity_id: number | null;
  /** Water interventions linked to this CRM opportunity. */
  interventions: string[] | null;
  next_task_title: string | null;
  next_task_due: string | null;
}

export interface Activity {
  id: number;
  organization_id: number;
  opportunity_id: number | null;
  project_id?: number | null;
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
  project_id: number | null;
  project_name: string | null;
  opportunity_pipeline: string | null;
  opportunity_type: string | null;
  opportunity_title: string | null;
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

/** What a staged import record describes. Records staged before migration 0007 have no entity_type → organization. */
export type ImportEntityType = "organization" | "project";
export type ImportKind = "organizations" | "projects" | "mixed";

export interface ImportRecord {
  index: number;
  entity_type?: ImportEntityType;
  data: OrganizationInput; // for project records this holds ProjectInput fields (see ProjectInput)
  field_sources: Record<string, FieldSource>;
  warnings: string[];
  duplicate: DuplicateResult | ProjectDuplicateResult;
  status: ImportRecordStatus;
  result_org_id: number | null;
  result_project_id?: number | null;
}

export interface ImportSummary {
  id: number;
  filename: string;
  file_type: string;
  kind: ImportKind;
  status: "processing" | "review" | "completed" | "failed";
  extraction_method: string | null;
  uploaded_by_name: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  stats: {
    found: number;
    new: number;
    existing: number;
    possible_duplicates: number;
    pending: number;
    approved: number;
    merged: number;
    rejected: number;
    organizations: number;
    projects: number;
  };
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
  water: WaterOpportunityCounts;
  /** Per-pipeline counts (WSIS Phase 7). */
  pipelines: Record<"relationship" | "project", PipelineCounts>;
}

export interface PipelineCounts {
  total: number;
  open: number;
  needingAction: number;
  followUpsDue: number;
  inProposal: number;
  proposalsAwaitingResponse: number;
  pilots: number;
  won: number;
}

export interface DashboardSummary {
  totalOrganizations: number;
  newOrganizations: number; // added in the last 7 days
  crmOpportunities: number;
  activeOpportunities: number;
  proposalsSent: number;
  pilots: number;
  overdueFollowUps: number;
  /** Opportunities per stage; `pipeline` distinguishes stages with the same name in both pipelines. */
  pipeline: { pipeline: string; status: string; count: number }[];
  pipelines: Record<"relationship" | "project", PipelineCounts>;
  water: WaterOpportunityCounts;
}

export interface SystemInfo {
  database: "postgres" | "pglite";
  geocoder: "nominatim" | "none";
  llm: boolean;
  llmModel: string | null;
  /** Latest applied migration version, e.g. "0001". */
  schemaVersion: string | null;
}

// ---------------------------------------------------------------------------------------------
// WSIS data model (migrations 0002–0005)
// ---------------------------------------------------------------------------------------------

export interface OrganizationTypeInfo {
  name: string;
  group_key: string;
  description: string | null;
  map_color: string | null;
  sort_order: number;
  active: boolean;
}

export interface FactDefinition {
  key: string;
  label: string;
  applies_to: "organization" | "project";
  value_type: "text" | "boolean" | "number" | "level" | "enum";
  allowed_values: string[] | null;
  multi_valued: boolean;
  type_groups: string[] | null;
  /** Saved organization views (architects, developers, contractors…) whose intelligence section shows this fact. */
  profiles: string[] | null;
  unit: string | null;
  description: string | null;
}

export interface Fact {
  id: number;
  fact_key: string;
  label: string;
  value: string;
  note: string | null;
  source: string | null;
  provenance: FactProvenance;
  confidence: DataConfidence;
  created_by_name: string | null;
  created_at: string;
  retired_at: string | null;
  replaces_fact_id: number | null;
}

export interface PipelineStage {
  name: string;
  sort_order: number;
  kind: "open" | "won" | "lost";
  is_outcome: boolean;
  milestone: "contacted" | "call" | "meeting" | "proposal" | "pilot" | "won" | null;
}

export interface Pipeline {
  key: string;
  label: string;
  description: string | null;
  is_default: boolean;
  stages: PipelineStage[];
}

export interface Catalog {
  organizationTypeGroups: { key: string; label: string }[];
  organizationTypes: OrganizationTypeInfo[];
  projectTypes: string[];
  lifecycleStages: LifecycleStage[];
  projectScales: ProjectScale[];
  stakeholderRoles: string[];
  waterInterventionTypes: string[];
  waterInterventions: WaterIntervention[];
  opportunityTypes: { name: string; default_pipeline: string }[];
  pipelines: Pipeline[];
  factDefinitions: FactDefinition[];
  organizationViews: OrganizationView[];
}

export interface ProjectInput {
  name: string;
  project_type?: string | null;
  description?: string | null;
  address?: string | null;
  area?: string | null;
  pincode?: string | null;
  lat?: number | null;
  lng?: number | null;
  website?: string | null;
  lifecycle_stage?: LifecycleStage | null;
  scale?: ProjectScale | null;
  built_up_area_sqft?: number | null;
  building_count?: number | null;
  unit_count?: number | null;
  notes?: string | null;
}

export interface Project {
  id: number;
  name: string;
  project_type: string | null;
  description: string | null;
  address: string | null;
  area: string | null;
  city: string;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  lifecycle_stage: LifecycleStage;
  scale: ProjectScale;
  built_up_area_sqft: number | null;
  building_count: number | null;
  unit_count: number | null;
  source_label: string | null;
  data_confidence: DataConfidence;
  field_sources: Record<string, FieldSource>;
  notes: string | null;
  merged_into: number | null;
  intelligence: Record<string, unknown>;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Project list row with a compact stakeholder summary. */
export interface ProjectListItem extends Project {
  stakeholder_count: number;
  water_opportunity_count: number;
  crm_opportunity_count: number;
  stakeholders: { organization_id: number; organization_name: string; role: string; is_primary: boolean }[];
}

export interface ProjectDuplicateCandidate {
  id: number;
  name: string;
  address: string | null;
  area: string | null;
  pincode: string | null;
  project_type: string | null;
  lifecycle_stage: string;
  distance_m: number | null;
  score: number;
  /** Names differ only by phase / tower / block — usually a separate project. */
  separate_part: boolean;
  reasons: string[];
}

export interface ProjectDuplicateResult {
  level: DuplicateMatchLevel;
  candidates: ProjectDuplicateCandidate[];
}

export interface ProjectStakeholder {
  id: number;
  project_id: number;
  project_name: string;
  organization_id: number;
  organization_name: string;
  org_type: string;
  role: string;
  is_primary: boolean;
  source: string | null;
  provenance: FactProvenance;
  confidence: DataConfidence;
  notes: string | null;
  project_type: string | null;
  lifecycle_stage: LifecycleStage;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  /** Present on organization → projects lists. */
  project_area?: string | null;
  water_opportunity_count?: number;
}

/** One piece of evidence behind a water opportunity, as it was when the opportunity was suggested. */
export interface EvidenceRef {
  /** fact: a project/organization fact; field: a record field (type, scale, units…); water_info: MVP water note; link: a stakeholder link. */
  kind: "fact" | "field" | "water_info" | "link";
  entity: "project" | "organization";
  entity_id: number;
  /** The exact fact version used (facts are versioned, so this row is never overwritten). */
  fact_id?: number | null;
  key: string;
  label: string;
  value: string;
  provenance: Provenance;
  source: string | null;
  confidence?: DataConfidence | null;
  /** Filled on read: the fact version has since been changed or withdrawn. */
  superseded?: boolean;
}

export interface WaterOpportunity {
  id: number;
  project_id: number | null;
  organization_id: number | null;
  intervention_type: string;
  intervention_key: string | null;
  intervention_group: string | null;
  context_key: string;
  potential: Potential;
  reason: string;
  evidence: string | null;
  evidence_refs: EvidenceRef[];
  evidence_current: boolean;
  source: string | null;
  provenance: FactProvenance;
  confidence: DataConfidence;
  origin: "manual" | "ai" | "import";
  suggested_by_agent: string | null;
  rule_key: string | null;
  status: WaterOpportunityStatus;
  outcome: WaterOpportunityOutcome | null;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  owner_id: number | null;
  owner_name: string | null;
  crm_opportunity_id: number | null;
  crm_status: string | null;
  crm_pipeline: string | null;
  crm_organization_id: number | null;
  crm_organization_name: string | null;
  project_name: string | null;
  organization_name: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  refreshed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Organization Details → "on this organization's projects": the organization's roles on that project. */
  organization_roles?: string[];
}

export interface WaterOpportunityHistoryEntry {
  id: number;
  action: string;
  actor_name: string | null;
  changes: Record<string, unknown>;
  at: string;
}

export interface WaterIntervention {
  key: string;
  label: string;
  group: string;
  group_label: string;
  description: string | null;
  sort_order: number;
  active: boolean;
}

/** Result of running the water opportunity rule engine on one project or organization. */
export interface WaterGenerateResult {
  created: number;
  refreshed: number;
  unchanged: number;
  kept: number;
  skipped_rejected: number;
  stale: number;
  opportunities: WaterOpportunity[];
}

/** Water opportunity counts exposed on the dashboard summary and daily brief (not yet shown in the UI). */
export interface WaterOpportunityCounts {
  toReview: number;
  approvedLast7Days: number;
  highPotentialOpen: number;
  projectAwaitingNextAction: number;
  /** Approved (trusted) water opportunities, project or organization level, not yet linked to a CRM opportunity. */
  approvedNotConverted: number;
}

/** GET /api/meta/organization-types — the database-backed organization taxonomy. */
export interface OrganizationTypeMeta {
  key: string; // stored verbatim in organizations.org_type
  label: string;
  group: string;
  group_label: string;
  sort_order: number;
  active: boolean;
  map_color: string | null;
  description: string | null;
}

export interface OrganizationView {
  key: string;
  label: string;
  description: string | null;
  types: string[];
}

export interface OrganizationTaxonomy {
  groups: { key: string; label: string; sort_order: number }[];
  types: OrganizationTypeMeta[];
  views: OrganizationView[];
}
