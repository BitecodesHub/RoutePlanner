export interface LatLng {
  lat: number;
  lng: number;
}

export function isValidLat(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLng(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function isValidCoordinate(lat: number, lng: number): boolean {
  // (0,0) is in the ocean and almost always signals a geocoding failure.
  return isValidLat(lat) && isValidLng(lng) && !(lat === 0 && lng === 0);
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Build a full pairwise haversine matrix (metres). */
export function haversineMatrix(points: LatLng[]): number[][] {
  return points.map((a) => points.map((b) => haversineMeters(a, b)));
}

const COORD_PAIR = /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/;

/**
 * Extract coordinates from a Google Maps URL (long form). Supports:
 *  - ?api=1&destination=lat,lng   - ?q=lat,lng    - ?query=lat,lng
 *  - /maps/@lat,lng,zoom          - /maps/place/…/@lat,lng,…
 *  - !3dLAT!4dLNG place data segments (precise pin position)
 */
export function parseGoogleMapsUrl(raw: string): LatLng | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!/(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|(^|\.)maps\.app\.goo\.gl$/.test(host)) {
    return null;
  }

  for (const key of ["destination", "q", "query", "ll", "center"]) {
    const v = url.searchParams.get(key);
    if (v) {
      const m = v.match(COORD_PAIR);
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (isValidCoordinate(lat, lng)) return { lat, lng };
      }
    }
  }

  // Pin position segments (!3d…!4d…) are more precise than the @viewport.
  const pin = url.pathname.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (pin) {
    const lat = parseFloat(pin[1]);
    const lng = parseFloat(pin[2]);
    if (isValidCoordinate(lat, lng)) return { lat, lng };
  }

  const at = url.pathname.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (at) {
    const lat = parseFloat(at[1]);
    const lng = parseFloat(at[2]);
    if (isValidCoordinate(lat, lng)) return { lat, lng };
  }

  return null;
}

export function isShortMapsLink(raw: string): boolean {
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    return host === "goo.gl" || host.endsWith(".goo.gl");
  } catch {
    return false;
  }
}

/** Parse free-text "lat, lng" input. */
export function parseLatLngText(raw: string): LatLng | null {
  const m = raw.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  return isValidCoordinate(lat, lng) ? { lat, lng } : null;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
