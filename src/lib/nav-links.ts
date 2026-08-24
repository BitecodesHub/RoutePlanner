/**
 * Deep links into Google Maps navigation (works on iOS, Android, and web —
 * no API key required). The dir API accepts at most 9 waypoints, so longer
 * routes fall back to per-leg links.
 */

export interface NavPoint {
  lat: number;
  lng: number;
}

const fmt = (p: NavPoint) => `${p.lat},${p.lng}`;

/** Full round trip in one Google Maps link (start → stops → start). */
export function googleMapsRouteUrl(start: NavPoint, stops: NavPoint[]): string {
  const params = new URLSearchParams({
    api: "1",
    travelmode: "driving",
    origin: fmt(start),
    destination: fmt(start),
  });
  if (stops.length > 0) {
    params.set("waypoints", stops.map(fmt).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Whether the whole route fits in a single Google Maps link. */
export function fitsSingleNavLink(stopCount: number): boolean {
  return stopCount <= 9;
}

/** Navigation link for a single leg (current position handled by Maps). */
export function googleMapsStopUrl(stop: NavPoint): string {
  const params = new URLSearchParams({
    api: "1",
    travelmode: "driving",
    destination: fmt(stop),
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * WhatsApp deep link with a prefilled message. When a phone number is given
 * the chat opens directly with that contact; otherwise WhatsApp asks the
 * sender to pick one. Works on mobile and WhatsApp Web without any API.
 */
export function whatsappShareUrl(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  const encoded = encodeURIComponent(text);
  return digits
    ? `https://wa.me/${digits}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
}
