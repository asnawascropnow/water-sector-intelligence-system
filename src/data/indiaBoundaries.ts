import { LatLngLiteral } from "../types/maps";

export interface DistrictBoundary {
  name: string;
  center: LatLngLiteral;
  paths: LatLngLiteral[];
  // Mock census stats for the hover card
  population: string;
  area: string;
  rainfall: string;
  groundwaterStatus: string;
}

export interface StateBoundary {
  name: string;
  center: LatLngLiteral;
  paths: LatLngLiteral[];
  districts: DistrictBoundary[];
}

export const STATE_BOUNDARIES: Record<string, StateBoundary> = {
  Karnataka: {
    name: "Karnataka",
    center: { lat: 15.3173, lng: 75.7139 },
    paths: [
      { lat: 18.4, lng: 77.5 }, // Bidar (North)
      { lat: 17.3, lng: 77.6 },
      { lat: 16.5, lng: 77.8 },
      { lat: 15.0, lng: 76.5 },
      { lat: 13.8, lng: 78.2 },
      { lat: 13.1, lng: 78.4 }, // Mulbagal (East)
      { lat: 12.8, lng: 78.3 },
      { lat: 11.6, lng: 77.2 }, // Chamarajanagar (South-East)
      { lat: 11.8, lng: 76.5 }, // South
      { lat: 12.2, lng: 75.5 },
      { lat: 12.8, lng: 75.0 },
      { lat: 14.0, lng: 74.3 }, // Karwar (West)
      { lat: 15.0, lng: 74.1 },
      { lat: 15.6, lng: 74.0 }, // North-West
      { lat: 16.3, lng: 75.0 },
      { lat: 17.5, lng: 76.0 },
      { lat: 18.0, lng: 76.8 },
    ],
    districts: [
      {
        name: "Bengaluru Urban",
        center: { lat: 12.9716, lng: 77.5946 },
        population: "11.3 Million",
        area: "2,190 km²",
        rainfall: "970 mm",
        groundwaterStatus: "Over-Exploited (Critical)",
        paths: [
          { lat: 13.18, lng: 77.45 },
          { lat: 13.18, lng: 77.78 },
          { lat: 12.98, lng: 77.85 },
          { lat: 12.72, lng: 77.72 },
          { lat: 12.72, lng: 77.40 },
          { lat: 12.95, lng: 77.35 },
        ]
      },
      {
        name: "Mysuru",
        center: { lat: 12.3088, lng: 76.6529 },
        population: "3.2 Million",
        area: "6,854 km²",
        rainfall: "780 mm",
        groundwaterStatus: "Semi-Critical",
        paths: [
          { lat: 12.65, lng: 76.35 },
          { lat: 12.60, lng: 76.85 },
          { lat: 12.20, lng: 76.95 },
          { lat: 11.95, lng: 76.60 },
          { lat: 12.10, lng: 76.15 },
        ]
      },
      {
        name: "Belagavi",
        center: { lat: 15.8497, lng: 74.4977 },
        population: "4.8 Million",
        area: "13,415 km²",
        rainfall: "820 mm",
        groundwaterStatus: "Safe",
        paths: [
          { lat: 16.20, lng: 74.30 },
          { lat: 16.30, lng: 74.80 },
          { lat: 15.95, lng: 75.10 },
          { lat: 15.60, lng: 74.75 },
          { lat: 15.70, lng: 74.15 },
        ]
      },
      {
        name: "Dakshina Kannada",
        center: { lat: 12.8701, lng: 74.8801 },
        population: "2.1 Million",
        area: "4,866 km²",
        rainfall: "3,800 mm",
        groundwaterStatus: "Safe",
        paths: [
          { lat: 13.15, lng: 74.75 },
          { lat: 13.10, lng: 75.25 },
          { lat: 12.75, lng: 75.40 },
          { lat: 12.60, lng: 74.90 },
        ]
      }
    ]
  },
  Gujarat: {
    name: "Gujarat",
    center: { lat: 22.2587, lng: 71.1924 },
    paths: [
      { lat: 23.8, lng: 68.2 }, // Kutch (West)
      { lat: 24.7, lng: 71.2 }, // North
      { lat: 24.4, lng: 73.8 }, // North-East
      { lat: 23.0, lng: 74.3 },
      { lat: 22.0, lng: 74.1 },
      { lat: 20.1, lng: 72.9 }, // South-East
      { lat: 20.8, lng: 72.1 }, // South
      { lat: 20.7, lng: 69.8 }, // South-West
      { lat: 22.3, lng: 68.9 }, // Dwarka (West coast)
      { lat: 23.1, lng: 69.5 },
    ],
    districts: [
      {
        name: "Ahmedabad",
        center: { lat: 23.0225, lng: 72.5714 },
        population: "7.8 Million",
        area: "8,707 km²",
        rainfall: "650 mm",
        groundwaterStatus: "Critical (Saline)",
        paths: [
          { lat: 23.35, lng: 72.35 },
          { lat: 23.30, lng: 72.85 },
          { lat: 22.80, lng: 72.90 },
          { lat: 22.65, lng: 72.25 },
        ]
      },
      {
        name: "Surat",
        center: { lat: 21.1702, lng: 72.8311 },
        population: "6.1 Million",
        area: "4,418 km²",
        rainfall: "1,120 mm",
        groundwaterStatus: "Semi-Critical",
        paths: [
          { lat: 21.40, lng: 72.65 },
          { lat: 21.35, lng: 73.15 },
          { lat: 20.95, lng: 73.10 },
          { lat: 21.00, lng: 72.70 },
        ]
      }
    ]
  },
  "Tamil Nadu": {
    name: "Tamil Nadu",
    center: { lat: 11.1271, lng: 78.6569 },
    paths: [
      { lat: 13.5, lng: 80.3 }, // Chennai (North)
      { lat: 12.5, lng: 79.9 },
      { lat: 11.5, lng: 79.8 },
      { lat: 10.3, lng: 79.4 },
      { lat: 9.3, lng: 79.3 }, // Rameshwaram (East)
      { lat: 8.8, lng: 78.2 },
      { lat: 8.1, lng: 77.5 }, // Kanyakumari (South)
      { lat: 8.5, lng: 77.1 },
      { lat: 9.6, lng: 77.3 },
      { lat: 11.0, lng: 76.8 }, // Coimbatore
      { lat: 11.5, lng: 76.3 }, // West
      { lat: 12.8, lng: 77.8 }, // North-West
      { lat: 13.0, lng: 79.2 },
    ],
    districts: [
      {
        name: "Chennai",
        center: { lat: 13.0827, lng: 80.2707 },
        population: "4.6 Million",
        area: "426 km²",
        rainfall: "1,400 mm",
        groundwaterStatus: "Critical (Coastal Intrusion)",
        paths: [
          { lat: 13.25, lng: 80.20 },
          { lat: 13.20, lng: 80.35 },
          { lat: 12.90, lng: 80.30 },
          { lat: 12.95, lng: 80.15 },
        ]
      },
      {
        name: "Coimbatore",
        center: { lat: 11.0168, lng: 76.9558 },
        population: "3.4 Million",
        area: "4,723 km²",
        rainfall: "700 mm",
        groundwaterStatus: "Semi-Critical",
        paths: [
          { lat: 11.25, lng: 76.80 },
          { lat: 11.20, lng: 77.15 },
          { lat: 10.80, lng: 77.10 },
          { lat: 10.85, lng: 76.80 },
        ]
      }
    ]
  },
  Maharashtra: {
    name: "Maharashtra",
    center: { lat: 19.7515, lng: 75.7139 },
    paths: [
      { lat: 22.0, lng: 72.6 },
      { lat: 22.0, lng: 76.0 }, // North
      { lat: 21.4, lng: 79.0 },
      { lat: 21.4, lng: 80.9 }, // North-East
      { lat: 19.8, lng: 80.2 },
      { lat: 18.7, lng: 80.3 }, // South-East
      { lat: 17.5, lng: 77.5 },
      { lat: 15.8, lng: 73.8 }, // South
      { lat: 16.5, lng: 73.3 },
      { lat: 19.0, lng: 72.8 }, // West
      { lat: 20.3, lng: 73.7 }, // North-West
    ],
    districts: [
      {
        name: "Mumbai",
        center: { lat: 19.0760, lng: 72.8777 },
        population: "12.5 Million",
        area: "603 km²",
        rainfall: "2,200 mm",
        groundwaterStatus: "Safe",
        paths: [
          { lat: 19.28, lng: 72.80 },
          { lat: 19.25, lng: 72.95 },
          { lat: 18.90, lng: 72.90 },
          { lat: 18.90, lng: 72.75 },
        ]
      },
      {
        name: "Pune",
        center: { lat: 18.5204, lng: 73.8567 },
        population: "9.4 Million",
        area: "15,643 km²",
        rainfall: "750 mm",
        groundwaterStatus: "Semi-Critical",
        paths: [
          { lat: 18.95, lng: 73.55 },
          { lat: 18.85, lng: 74.25 },
          { lat: 18.15, lng: 74.30 },
          { lat: 18.25, lng: 73.50 },
        ]
      }
    ]
  }
};
