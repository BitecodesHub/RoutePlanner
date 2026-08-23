import type { LatLng } from "@/lib/geo";
import { getTravelMatrix, getRoutePath, type DistanceSource } from "@/lib/osrm";
import { solveTsp } from "@/lib/optimizer";

/**
 * Core route-building logic shared by the create / update / preview
 * endpoints: optimise stop order (or keep a manual order), then fetch the
 * road path and per-leg metrics.
 */

export interface ShopPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface BuiltStop {
  shopId: string;
  sequence: number; // 1-based
  legDistanceM: number;
  legDurationS: number;
}

export interface BuiltRoute {
  orderedShops: ShopPoint[];
  stops: BuiltStop[];
  totalDistanceM: number;
  totalDurationS: number;
  returnLegDistanceM: number;
  returnLegDurationS: number;
  /** [lat,lng] pairs tracing the full round trip on roads. */
  geometry: [number, number][];
  distanceSource: DistanceSource;
}

export async function buildRoute(
  start: LatLng,
  shops: ShopPoint[],
  options: { keepOrder: boolean },
): Promise<BuiltRoute> {
  if (shops.length === 0) {
    throw new Error("A route needs at least one stop");
  }

  let ordered: ShopPoint[];
  if (options.keepOrder) {
    ordered = shops;
  } else {
    const points: LatLng[] = [
      { lat: start.lat, lng: start.lng },
      ...shops.map((s) => ({ lat: s.latitude, lng: s.longitude })),
    ];
    const matrix = await getTravelMatrix(points);
    const { order } = solveTsp(matrix.durations);
    ordered = order.map((idx) => shops[idx - 1]);
  }

  const orderedPoints: LatLng[] = [
    { lat: start.lat, lng: start.lng },
    ...ordered.map((s) => ({ lat: s.latitude, lng: s.longitude })),
  ];
  const path = await getRoutePath(orderedPoints, true);

  // path.legs has ordered.length + 1 entries (…final leg returns to start).
  const stops: BuiltStop[] = ordered.map((s, i) => ({
    shopId: s.id,
    sequence: i + 1,
    legDistanceM: path.legs[i]?.distanceM ?? 0,
    legDurationS: path.legs[i]?.durationS ?? 0,
  }));
  const returnLeg = path.legs[ordered.length] ?? { distanceM: 0, durationS: 0 };

  return {
    orderedShops: ordered,
    stops,
    totalDistanceM: path.distanceM,
    totalDurationS: path.durationS,
    returnLegDistanceM: returnLeg.distanceM,
    returnLegDurationS: returnLeg.durationS,
    geometry: path.coordinates,
    distanceSource: path.source,
  };
}
