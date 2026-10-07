// Shared constants used by both the API server and the React client.
// Bengaluru-only MVP: geography is fixed here so it can later be made configurable per city.

export const CITY = {
  name: "Bengaluru",
  state: "Karnataka",
  country: "India",
  center: { lat: 12.9716, lng: 77.5946 },
  defaultZoom: 11,
  minZoom: 10,
  // Bengaluru metropolitan area (BBMP + surrounding industrial belts). Used for map limits and validation.
  bounds: { south: 12.72, west: 77.3, north: 13.35, east: 77.92 },
} as const;

export const ORG_TYPES = [
  "Manufacturing",
  "Industrial",
  "IT / Technology",
  "Hospital",
  "Hotel",
  "School",
  "College / University",
  "Apartment",
  "Commercial",
  "Institution",
  "Government",
  "Other",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ORG_TYPE_COLORS: Record<OrgType, string> = {
  Manufacturing: "#d9480f",
  Industrial: "#9c36b5",
  "IT / Technology": "#1971c2",
  Hospital: "#e03131",
  Hotel: "#f08c00",
  School: "#2f9e44",
  "College / University": "#0c8599",
  Apartment: "#5c7cfa",
  Commercial: "#a61e4d",
  Institution: "#66a80f",
  Government: "#495057",
  Other: "#868e96",
};

export const DATA_CONFIDENCE = ["High", "Medium", "Low", "Unknown"] as const;
export type DataConfidence = (typeof DATA_CONFIDENCE)[number];

// Provenance labels (Rule 2 — never invent data).
export const PROVENANCE = ["Verified", "Unverified", "Estimated", "AI Inference", "Unknown"] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const PIPELINE_STAGES = ["New", "Contacted", "Call", "Proposal Sent", "Follow-up", "Pilot", "Converted"] as const;
export const OUTCOME_STAGES = ["Not Interested", "Lost", "Nurture"] as const;
export const CRM_STATUSES = [...PIPELINE_STAGES, ...OUTCOME_STAGES] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];
export const CLOSED_STATUSES: CrmStatus[] = ["Converted", "Not Interested", "Lost"];

export const CALL_STATUSES = [
  "Not Started",
  "Contact Attempted",
  "Connected",
  "No Response",
  "Call Scheduled",
  "Call Completed",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const PROPOSAL_STATUSES = ["Not Started", "Drafting", "Sent", "Accepted", "Rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PILOT_STATUSES = ["Not Started", "Planned", "In Progress", "Completed", "Cancelled"] as const;
export type PilotStatus = (typeof PILOT_STATUSES)[number];

export const TASK_TYPES = ["Follow-up", "Call", "Proposal", "Meeting", "Other"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_PRIORITIES = ["High", "Medium", "Low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_STATUSES = ["Pending", "Done", "Cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const POTENTIAL_LEVELS = ["High", "Medium", "Low", "Unknown"] as const;
export type Potential = (typeof POTENTIAL_LEVELS)[number];

// Interaction types a user can log against a CRM opportunity. Each maps to a call status where relevant.
export const INTERACTION_TYPES = [
  { type: "contact_attempted", label: "Contact attempted", callStatus: "Contact Attempted" },
  { type: "connected", label: "Connected", callStatus: "Connected" },
  { type: "no_response", label: "No response", callStatus: "No Response" },
  { type: "call_scheduled", label: "Call scheduled", callStatus: "Call Scheduled" },
  { type: "call_completed", label: "Call completed", callStatus: "Call Completed" },
  { type: "proposal_sent", label: "Proposal sent", callStatus: null },
  { type: "note", label: "Note", callStatus: null },
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number]["type"];

export const IMPORT_FILE_TYPES = ["xlsx", "csv", "pdf", "docx"] as const;
