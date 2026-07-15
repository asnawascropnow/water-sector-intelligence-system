export type Category = "Industry" | "Manufacturing" | "University" | "College" | "School" | "Hospital" | "Apartment/Residential" | "Other";
export type RwhStatus = "Verified - Has RWH" | "Verified - No RWH" | "Unknown";
export type WaterStressLevel = "Safe" | "Semi-Critical" | "Critical" | "Over-Exploited";
export type ConfidenceLevel = "Official Dataset" | "Crowd-Verified" | "Unverified Estimate";
export type LeadStage = "Identified" | "Contacted" | "Proposal Sent" | "Won" | "Lost";

export interface Location {
  id: string;
  name: string;
  category: Category;
  address: string;
  taluk: string;
  district: string;
  state: string;
  pincode: string;
  lat: number;
  lng: number;
  landAreaAcres: number;
  waterSource: string; // e.g. "Borewell", "Municipal (Cauvery)", "Tanker", "Mixed"
  rwhStatus: RwhStatus;
  waterStressLevel: WaterStressLevel;
  legallyObligatedForRwh: boolean;
  confidenceLevel: ConfidenceLevel;
  contactName?: string;
  contactDesignation?: string;
  contactPhone?: string;
  contactEmail?: string;
  website?: string;
  dataSource: string; // e.g. "AISHE", "KSPCB Consent Order", "Manual Site Visit"
  lastVerifiedDate: string; // ISO date
  leadStage: LeadStage;
  notes?: string;
}

export type Priority = "High" | "Medium" | "Low";
export type WorkStatus = "Not Started" | "Contacted" | "Site Visit Scheduled" | "Proposal Drafting" | "Proposal Sent" | "Negotiation" | "Won" | "Lost" | "On Hold";
export type Team = "Water Intelligence" | "Industry Outreach" | "Technical" | "Project Execution";

export interface TeamMember {
  id: string;
  name: string;
  team: Team;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string; // ISO date
  author: string; // team member name
  note: string;
}

export interface MeetingNote {
  id: string;
  date: string; // ISO date
  attendees: string[];
  summary: string;
}

export interface DocumentRef {
  id: string;
  label: string;
  url: string; // placeholder link or filename
}

export interface Assignment {
  locationId: string; // foreign key to Location.id
  assignedToId: string; // foreign key to TeamMember.id
  team: Team;
  priority: Priority;
  currentStatus: WorkStatus;
  nextFollowUpDate?: string; // ISO date
  activityLog: ActivityLogEntry[];
  meetingNotes: MeetingNote[];
  documents: DocumentRef[];
  createdDate: string;
}

