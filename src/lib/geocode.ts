import { env } from "@/lib/env";
import {
  isShortMapsLink,
  parseGoogleMapsUrl,
  parseLatLngText,
  isValidCoordinate,
  type LatLng,
} from "@/lib/geo";

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

const FETCH_TIMEOUT_MS = 8000;

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "shop-route-system/1.0 (route planning)" },
    });
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Free-text address search via Nominatim (OpenStreetMap). */
export async function searchAddress(query: string, limit = 5): Promise<GeocodeResult[]> {
  const url = `${env.nominatimBaseUrl}/search?format=jsonv2&limit=${limit}&q=${encodeURIComponent(query)}`;
  const data = (await fetchJson(url)) as { display_name: string; lat: string; lon: string }[];
  return data
    .map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }))
    .filter((d) => isValidCoordinate(d.lat, d.lng));
}

/** Follow a short goo.gl / maps.app.goo.gl link to its long form. */
async function expandShortLink(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "shop-route-system/1.0" },
    });
    return res.url || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve any user-supplied location input to coordinates:
 * raw "lat,lng" text, a Google Maps URL (long or shortened), or a
 * free-text address (geocoded via Nominatim).
 */
export async function resolveLocation(
  input: string,
): Promise<{ result: GeocodeResult | null; candidates?: GeocodeResult[] }> {
  const trimmed = input.trim();
  if (!trimmed) return { result: null };

  const asCoords = parseLatLngText(trimmed);
  if (asCoords) {
    return { result: { label: `${asCoords.lat}, ${asCoords.lng}`, ...asCoords } };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let target = trimmed;
    if (isShortMapsLink(trimmed)) {
      const expanded = await expandShortLink(trimmed);
      if (expanded) target = expanded;
    }
    const fromUrl: LatLng | null = parseGoogleMapsUrl(target);
    if (fromUrl) {
      return { result: { label: `${fromUrl.lat}, ${fromUrl.lng}`, ...fromUrl } };
    }
    return { result: null };
  }

  const candidates = await searchAddress(trimmed);
  return { result: candidates[0] ?? null, candidates };
}
