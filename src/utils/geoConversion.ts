import { GeoJSONGeometry } from "../data/mockData.types";

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

/**
 * Converts a GeoJSON Point coordinate [lng, lat] to a Google Maps LatLngLiteral.
 */
export function getPointLatLng(geometry: GeoJSONGeometry): LatLngLiteral {
  if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) {
    throw new Error("Invalid GeoJSON Point geometry");
  }
  const [lng, lat] = geometry.coordinates;
  return { lat, lng };
}

/**
 * Converts a GeoJSON Polygon coordinates ring to Google Maps LatLngLiteral paths.
 * GeoJSON polygon coordinates structure is: [ [ [lng, lat], [lng, lat], ... ] ]
 */
export function getPolygonPaths(geometry: GeoJSONGeometry): LatLngLiteral[][] {
  if (geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) {
    return [];
  }
  
  return geometry.coordinates.map((ring: any) => {
    if (!Array.isArray(ring)) return [];
    return ring.map((pt: any) => {
      const [lng, lat] = pt;
      return { lat, lng };
    });
  });
}

/**
 * Converts a GeoJSON MultiPolygon coordinate rings to Google Maps LatLngLiteral paths.
 * GeoJSON multipolygon coordinates structure is: [ Polygon1, Polygon2, ... ]
 */
export function getMultiPolygonPaths(geometry: GeoJSONGeometry): LatLngLiteral[][][] {
  if (geometry.type !== "MultiPolygon" || !Array.isArray(geometry.coordinates)) {
    return [];
  }

  return geometry.coordinates.map((polyCoords: any) => {
    if (!Array.isArray(polyCoords)) return [];
    return polyCoords.map((ring: any) => {
      if (!Array.isArray(ring)) return [];
      return ring.map((pt: any) => {
        const [lng, lat] = pt;
        return { lat, lng };
      });
    });
  });
}
