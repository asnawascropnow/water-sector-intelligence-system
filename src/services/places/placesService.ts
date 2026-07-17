import { Location, Category, RwhStatus, WaterStressLevel, ConfidenceLevel, LeadStage } from "../../data/mockData.types";
import { MapFilters, GooglePlaceDetails } from "../../types/maps";

// Category mapping helper
export function mapGoogleTypeToCategory(type: string): Category {
  const t = type.toLowerCase();
  if (t.includes("school")) return "School";
  if (t.includes("university")) return "University";
  if (t.includes("college")) return "College";
  if (t.includes("hospital") || t.includes("doctor") || t.includes("health")) return "Hospital";
  if (t.includes("lodging") || t.includes("hotel") || t.includes("resort")) return "Hotel";
  if (t.includes("apartment") || t.includes("condominium") || t.includes("residential")) return "Apartment/Residential";
  if (t.includes("government") || t.includes("city_hall") || t.includes("court") || t.includes("police")) return "Government Building";
  if (t.includes("data_center") || t.includes("server") || t.includes("tech")) return "Data Centre";
  if (t.includes("quarry") || t.includes("mining")) return "Mining";
  if (t.includes("factory") || t.includes("industrial") || t.includes("manufacturing")) return "Manufacturing";
  return "Industry"; // default fallback
}

// Generate realistic default water intelligence based on org type
function generateWaterIntel(name: string, type: string, state: string): {
  landAreaAcres: number;
  waterSource: string;
  rwhStatus: RwhStatus;
  waterStressLevel: WaterStressLevel;
  legallyObligatedForRwh: boolean;
  notes: string;
} {
  const t = type.toLowerCase();
  const stateLower = state.toLowerCase();
  
  // Default values
  let landAreaAcres = 2.5;
  let waterSource = "Municipal (Cauvery)";
  let rwhStatus: RwhStatus = "unknown";
  let waterStressLevel: WaterStressLevel = "Safe";
  let legallyObligatedForRwh = false;
  let notes = "Discovered twin node. Water intelligence audit pending.";

  // Tailored by location
  if (stateLower.includes("karnataka") || name.toLowerCase().includes("bangalore") || name.toLowerCase().includes("bengaluru")) {
    waterSource = "Borewell & Tanker";
    waterStressLevel = "Critical";
  } else if (stateLower.includes("rajasthan") || stateLower.includes("gujarat")) {
    waterSource = "Tanker & Borewell";
    waterStressLevel = "Over-Exploited";
  }

  // Tailored by category
  if (t.includes("hospital")) {
    landAreaAcres = 6.2;
    waterSource = "Municipal & Borewell";
    legallyObligatedForRwh = true;
    notes = "High occupancy medical facility. Estimated water consumption 150 KL/day.";
  } else if (t.includes("data")) {
    landAreaAcres = 15.0;
    waterSource = "Borewell & Tanker";
    waterStressLevel = "Over-Exploited";
    legallyObligatedForRwh = true;
    notes = "Data center cooling towers. High evaporative loss. Massive rainwater harvest potential.";
  } else if (t.includes("university") || t.includes("college")) {
    landAreaAcres = 42.5;
    waterSource = "Mixed (Rainwater + Borewell)";
    rwhStatus = "verified_has_rwh";
    legallyObligatedForRwh = true;
    notes = "Large institutional campus. Highly suited for aquifer recharge structures.";
  } else if (t.includes("apartment") || t.includes("residential")) {
    landAreaAcres = 8.4;
    waterSource = "Tanker & Borewell";
    legallyObligatedForRwh = true;
    notes = "Residential high-rise community. Borewell yields declining. RWH check needed.";
  } else if (t.includes("manufacturing") || t.includes("factory") || t.includes("industry")) {
    landAreaAcres = 55.0;
    waterSource = "Borewell & Tanker";
    waterStressLevel = "Critical";
    legallyObligatedForRwh = true;
    notes = "Industrial production site. Subject to zero liquid discharge regulations.";
  } else if (t.includes("mining") || t.includes("quarry")) {
    landAreaAcres = 120.0;
    waterSource = "Borewell";
    waterStressLevel = "Over-Exploited";
    legallyObligatedForRwh = true;
    notes = "Mining / excavation cluster. Ground water table drawdown risk verified.";
  }

  return {
    landAreaAcres,
    waterSource,
    rwhStatus,
    waterStressLevel,
    legallyObligatedForRwh,
    notes,
  };
}

/**
 * Promise-based search wrapper for Google Places Service
 */
export function searchPlaces(
  map: google.maps.Map,
  filters: MapFilters
): Promise<Location[]> {
  return new Promise((resolve, reject) => {
    if (typeof google === "undefined" || !google.maps || !google.maps.places) {
      reject(new Error("Google Maps JavaScript library not loaded"));
      return;
    }

    const service = new google.maps.places.PlacesService(map);
    
    // Construct rich text query combining user filters
    const queryParts: string[] = [];
    if (filters.searchKeyword) queryParts.push(filters.searchKeyword);
    if (filters.organizationType) queryParts.push(filters.organizationType);
    else if (filters.category) queryParts.push(filters.category);

    if (filters.city) queryParts.push(filters.city);
    if (filters.taluk) queryParts.push(filters.taluk);
    if (filters.district) queryParts.push(filters.district);
    if (filters.state) queryParts.push(filters.state);
    
    const query = queryParts.join(" ");

    const request: google.maps.places.TextSearchRequest = {
      query,
    };

    // If we have a map center, search around it
    const mapCenter = map.getCenter();
    if (mapCenter) {
      request.location = mapCenter;
      request.radius = filters.radius || 5000;
    }

    service.textSearch(request, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        const locationsList: Location[] = results.map((place, idx) => {
          const name = place.name || "Discovered Organization";
          const placeTypes = place.types || [];
          const primaryType = placeTypes[0] || filters.organizationType || filters.category || "industry";
          const cat = mapGoogleTypeToCategory(primaryType);
          
          const lat = place.geometry?.location?.lat() || 20.5937;
          const lng = place.geometry?.location?.lng() || 78.9629;
          
          const formattedAddress = place.formatted_address || "";
          
          const state = filters.state || "Karnataka";
          const district = filters.district || filters.city || "Bengaluru Urban";
          const subCategory = primaryType;

          const waterIntel = generateWaterIntel(name, primaryType, state);
          
          const rwhStatusMapped = waterIntel.rwhStatus;

          return {
            id: `discovered-${place.place_id || 'loc-' + idx}`,
            placeId: place.place_id,
            name,
            category: cat,
            subCategory,
            address: formattedAddress,
            website: "",
            phone: "",
            email: "",
            district,
            state,
            country: "India",
            postalCode: formattedAddress.match(/\b\d{6}\b/)?.[0] || "560001",
            location: { lat, lng },
            geometry: {
              source: "google_places",
              confidence: 65,
              lastUpdated: new Date().toISOString(),
              geojson: {
                type: "Point",
                coordinates: [lng, lat]
              }
            },
            water: {
              estimatedConsumption: Math.round(waterIntel.landAreaAcres * 12.5),
              estimatedRoofArea: Math.round(waterIntel.landAreaAcres * 4046.86 * 0.25),
              waterSource: waterIntel.waterSource,
              groundwaterDependency: waterIntel.waterSource.toLowerCase().includes("borewell") ? 80 : 0,
              rainwaterHarvesting: {
                status: rwhStatusMapped,
                verified: rwhStatusMapped !== "unknown"
              },
              waterStressLevel: waterIntel.waterStressLevel
            },
            crm: {
              assignedTo: null,
              status: "Identified",
              priority: null
            },
            projects: [],
            funding: [],
            documents: [],
            timeline: []
          } as Location;
        });

        resolve(locationsList);
      } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        resolve([]);
      } else {
        reject(new Error(`Places Search failed with status: ${status}`));
      }
    });
  });
}

/**
 * Promise-based detail fetching wrapper for Google Places Service
 */
export function fetchPlaceDetails(
  map: google.maps.Map,
  placeId: string
): Promise<GooglePlaceDetails> {
  return new Promise((resolve, reject) => {
    if (typeof google === "undefined" || !google.maps || !google.maps.places) {
      reject(new Error("Google Maps JavaScript library not loaded"));
      return;
    }

    const service = new google.maps.places.PlacesService(map);
    const request = {
      placeId,
      fields: [
        "formatted_address",
        "website",
        "formatted_phone_number",
        "rating",
        "business_status",
        "photos",
        "reviews",
      ],
    };

    service.getDetails(request, (place, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && place) {
        const photosList = place.photos 
          ? place.photos.slice(0, 3).map(p => p.getUrl({ maxWidth: 400 })) 
          : [];

        resolve({
          placeId,
          formattedAddress: place.formatted_address,
          website: place.website,
          formattedPhoneNumber: place.formatted_phone_number,
          rating: place.rating,
          businessStatus: place.business_status,
          photos: photosList,
          reviewsCount: place.reviews ? place.reviews.length : 0,
        });
      } else {
        reject(new Error(`Place Details failed with status: ${status}`));
      }
    });
  });
}
