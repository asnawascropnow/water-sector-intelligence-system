import { Location } from "../data/mockData.types";

export interface MapFilters {
  state: string;
  district: string;
  taluk: string;
  city: string;
  radius: number; // in meters
  category: string;
  subCategory: string;
  ownership: "Government" | "Private" | "Public" | "All";
  organizationType: string;
  searchKeyword: string;
}

export type MapLoadingStatus = "idle" | "loading" | "success" | "error";

export type MapErrorType = 
  | "quota_exceeded" 
  | "zero_results" 
  | "api_failure" 
  | "timeout" 
  | "invalid_filters" 
  | "offline"
  | null;

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

export interface PlacesSearchCache {
  [queryHash: string]: Location[];
}
