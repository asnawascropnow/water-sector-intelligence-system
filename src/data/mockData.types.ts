export type Category =
  | "Industry"
  | "Manufacturing"
  | "Mining"
  | "School"
  | "College"
  | "University"
  | "Hospital"
  | "Apartment/Residential"
  | "Hotel"
  | "Government Building"
  | "Data Centre";
export type RwhStatus = "verified_has_rwh" | "verified_no_rwh" | "unknown";
export type WaterStressLevel = "Safe" | "Semi-Critical" | "Critical" | "Over-Exploited";
export type ConfidenceLevel = "Official Dataset" | "Crowd-Verified" | "Unverified Estimate";
export type LeadStage = "Identified" | "Contacted" | "Proposal Sent" | "Won" | "Lost";

export interface GeoJSONGeometry {
  type: "Point" | "Polygon" | "MultiPolygon" | "LineString" | "GeometryCollection";
  coordinates: any;
}

export interface OrganizationGeometry {
  source: 
    | "google_places"
    | "openstreetmap"
    | "government_gis"
    | "manual_survey"
    | "satellite_detection"
    | "drone_mapping"
    | "uploaded_geojson"
    | "uploaded_kml"
    | "uploaded_shapefile"
    | "estimated";
  confidence: number;
  lastUpdated: string;
  geojson: GeoJSONGeometry;
}

export interface OrganizationWater {
  estimatedConsumption: number | null;
  estimatedRoofArea: number | null;
  waterSource: string | null;
  groundwaterDependency: number | null;
  rainwaterHarvesting: {
    status: RwhStatus;
    verified: boolean;
  };
  waterStressLevel: WaterStressLevel;
}

export interface OrganizationCRM {
  assignedTo: string | null;
  status: string;
  priority: "High" | "Medium" | "Low" | null;
}

export interface Location {
  id: string;
  placeId?: string;
  name: string;
  category: Category;
  subCategory: string;
  address: string;
  website: string;
  phone: string;
  email: string;
  district: string;
  state: string;
  country: string;
  postalCode: string;
  location: {
    lat: number;
    lng: number;
  };
  geometry: OrganizationGeometry;
  water: OrganizationWater;
  crm: OrganizationCRM;
  projects: any[];
  funding: any[];
  documents: any[];
  timeline: any[];
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

export interface GooglePlaceDetails {
  placeId: string;
  formattedAddress?: string;
  website?: string;
  formattedPhoneNumber?: string;
  rating?: number;
  businessStatus?: string;
  photos?: string[];
  reviewsCount?: number;
}

