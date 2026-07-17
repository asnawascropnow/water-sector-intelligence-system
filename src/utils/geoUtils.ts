import { Location } from "../data/mockData.types";

export interface MarkerCluster {
  id: string;
  lat: number;
  lng: number;
  locations: Location[];
  count: number;
}

/**
 * Calculates distance between two coordinates in meters using the Haversine formula.
 */
export function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3; // meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

/**
 * Verifies whether a latitude/longitude coordinate is inside Google Maps viewport bounds.
 */
export function isPointInBounds(
  lat: number,
  lng: number,
  bounds: google.maps.LatLngBounds | null
): boolean {
  if (!bounds) return true;
  return bounds.contains({ lat, lng });
}

/**
 * Returns the threshold distance in degrees based on zoom level.
 */
function getClusteringThreshold(zoom: number): number {
  if (zoom <= 4) return 2.0;
  if (zoom === 5) return 1.5;
  if (zoom === 6) return 1.0;
  if (zoom === 7) return 0.6;
  if (zoom === 8) return 0.35;
  if (zoom === 9) return 0.2;
  if (zoom === 10) return 0.1;
  if (zoom === 11) return 0.05;
  if (zoom === 12) return 0.02;
  if (zoom === 13) return 0.008;
  if (zoom === 14) return 0.003;
  return 0; // Zoom 15+ has no clustering
}

/**
 * Clusters a list of locations based on zoom level.
 * Returns a mixed list of single Locations and MarkerClusters.
 */
export function clusterMarkers(
  locations: Location[],
  zoom: number
): (Location | MarkerCluster)[] {
  const threshold = getClusteringThreshold(zoom);
  if (threshold === 0) return locations;

  const clusters: MarkerCluster[] = [];
  const clusteredLocIds = new Set<string>();

  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    if (clusteredLocIds.has(loc.id)) continue;

    // Start a new cluster centered on this location
    const cluster: MarkerCluster = {
      id: `cluster-${loc.id}`,
      lat: loc.location.lat,
      lng: loc.location.lng,
      locations: [loc],
      count: 1
    };

    // Find other close locations
    for (let j = i + 1; j < locations.length; j++) {
      const other = locations[j];
      if (clusteredLocIds.has(other.id)) continue;

      const dLat = Math.abs(loc.location.lat - other.location.lat);
      const dLng = Math.abs(loc.location.lng - other.location.lng);
      
      if (dLat < threshold && dLng < threshold) {
        cluster.locations.push(other);
        cluster.count++;
        clusteredLocIds.add(other.id);
      }
    }

    // If it clustered more than 1 point, adjust the center to be average of all points in the cluster
    if (cluster.count > 1) {
      let sumLat = 0;
      let sumLng = 0;
      cluster.locations.forEach(l => {
        sumLat += l.location.lat;
        sumLng += l.location.lng;
      });
      cluster.lat = sumLat / cluster.count;
      cluster.lng = sumLng / cluster.count;
      
      clusters.push(cluster);
      clusteredLocIds.add(loc.id);
      cluster.locations.forEach(l => clusteredLocIds.add(l.id));
    }
  }

  // Add all locations that were NOT clustered as individual elements
  const results: (Location | MarkerCluster)[] = [];
  locations.forEach(loc => {
    if (!clusteredLocIds.has(loc.id)) {
      results.push(loc);
    }
  });

  return [...results, ...clusters];
}
