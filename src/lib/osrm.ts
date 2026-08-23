import { env } from "@/lib/env";
import { haversineMatrix, type LatLng } from "@/lib/geo";

/**
 * OSRM routing client with timeout, retry, and a haversine fallback so the
 * product keeps working when the routing service is unreachable.
 */

const FETCH_TIMEOUT_MS = 9000;
const MAX_ATTEMPTS = 2;

// Fallback model: straight-line distance inflated by a typical road detour
// factor, at an average urban speed.
const ROAD_DETOUR_FACTOR = 1.35;
const AVG_SPEED_MPS = 25_000 / 3600; // 25 km/h

export type DistanceSource = "OSRM" | "HAVERSINE";

export interface Matrix {
  distances: number[][]; // metres
  durations: number[][]; // seconds
  source: DistanceSource;
}

export interface RoutePath {
  coordinates: [number, number][]; // [lat, lng] pairs for the map
  distanceM: number;
  durationS: number;
  legs: { distanceM: number; durationS: number }[];
  source: DistanceSource;
}

async function fetchJsonWithRetry(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "shop-route-system/1.0" },
      });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function coordString(points: LatLng[]): string {
  return points.map((p) => `${p.lng},${p.lat}`).join(";");
}

export function fallbackMatrix(points: LatLng[]): Matrix {
  const distances = haversineMatrix(points).map((row) =>
    row.map((d) => d * ROAD_DETOUR_FACTOR),
  );
  const durations = distances.map((row) => row.map((d) => d / AVG_SPEED_MPS));
  return { distances, durations, source: "HAVERSINE" };
}

/**
 * Pairwise travel matrix. Uses the OSRM table service; falls back to a
 * haversine estimate when OSRM is unavailable or the size limit is exceeded.
 */
export async function getTravelMatrix(points: LatLng[]): Promise<Matrix> {
  if (points.length < 2) return { distances: [[0]], durations: [[0]], source: "OSRM" };
  // Public OSRM caps table requests at ~100 coordinates.
  if (points.length > 100) return fallbackMatrix(points);
  try {
    const url = `${env.osrmBaseUrl}/table/v1/driving/${coordString(points)}?annotations=duration,distance`;
    const data = (await fetchJsonWithRetry(url)) as {
      code?: string;
      durations?: number[][];
      distances?: number[][];
    };
    if (data.code !== "Ok" || !data.durations || !data.distances) {
      throw new Error(`OSRM table error: ${data.code}`);
    }
    // OSRM may return nulls for unroutable pairs; patch with haversine.
    const hv = fallbackMatrix(points);
    const distances = data.distances.map((row, i) =>
      row.map((v, j) => (v == null ? hv.distances[i][j] : v)),
    );
    const durations = data.durations.map((row, i) =>
      row.map((v, j) => (v == null ? hv.durations[i][j] : v)),
    );
    return { distances, durations, source: "OSRM" };
  } catch (err) {
    console.warn("[osrm] table failed, using haversine fallback:", (err as Error).message);
    return fallbackMatrix(points);
  }
}

/**
 * Road-following path for an ordered sequence of points (start → stops → start
 * when roundTrip). Falls back to straight lines between points.
 */
export async function getRoutePath(
  orderedPoints: LatLng[],
  roundTrip: boolean,
): Promise<RoutePath> {
  const pts = roundTrip ? [...orderedPoints, orderedPoints[0]] : orderedPoints;
  if (pts.length < 2) {
    return { coordinates: [], distanceM: 0, durationS: 0, legs: [], source: "OSRM" };
  }
  try {
    const url = `${env.osrmBaseUrl}/route/v1/driving/${coordString(pts)}?overview=full&geometries=geojson&steps=false`;
    const data = (await fetchJsonWithRetry(url)) as {
      code?: string;
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs: { distance: number; duration: number }[];
      }[];
    };
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) throw new Error(`OSRM route error: ${data.code}`);
    return {
      coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceM: route.distance,
      durationS: route.duration,
      legs: route.legs.map((l) => ({ distanceM: l.distance, durationS: l.duration })),
      source: "OSRM",
    };
  } catch (err) {
    console.warn("[osrm] route failed, using straight-line fallback:", (err as Error).message);
    const legs: { distanceM: number; durationS: number }[] = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const m = fallbackMatrix([pts[i], pts[i + 1]]);
      legs.push({ distanceM: m.distances[0][1], durationS: m.durations[0][1] });
      total += m.distances[0][1];
    }
    return {
      coordinates: pts.map((p) => [p.lat, p.lng]),
      distanceM: total,
      durationS: total / AVG_SPEED_MPS,
      legs,
      source: "HAVERSINE",
    };
  }
}
