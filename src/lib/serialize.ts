import type { Prisma } from "@prisma/client";
import type { DriverDto, RouteDto, RouteListItemDto, RouteStopDto, ShopDto } from "@/lib/types";

/** Prisma → DTO mappers so every endpoint returns identical shapes. */

type ShopRecord = Prisma.ShopGetPayload<object>;
type UserRecord = Prisma.UserGetPayload<object>;
type RouteWithStops = Prisma.RouteGetPayload<{
  include: { stops: { include: { shop: true } }; driver: true };
}>;
type RouteWithCount = Prisma.RouteGetPayload<{
  include: { driver: true; _count: { select: { stops: true } } };
}>;

export function shopToDto(s: ShopRecord): ShopDto {
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    latitude: s.latitude,
    longitude: s.longitude,
    contactName: s.contactName,
    phone: s.phone,
    email: s.email,
    notes: s.notes,
    externalRef: s.externalRef,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function driverToDto(u: UserRecord, activeRouteCount?: number): DriverDto {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    status: u.status,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    ...(activeRouteCount !== undefined ? { activeRouteCount } : {}),
  };
}

export function routeToDto(r: RouteWithStops): RouteDto {
  const stops: RouteStopDto[] = [...r.stops]
    .sort((a, b) => a.sequence - b.sequence)
    .map((st) => ({
      id: st.id,
      sequence: st.sequence,
      status: st.status,
      legDistanceM: st.legDistanceM,
      legDurationS: st.legDurationS,
      arrivedAt: st.arrivedAt?.toISOString() ?? null,
      completedAt: st.completedAt?.toISOString() ?? null,
      notes: st.notes,
      shop: shopToDto(st.shop),
    }));

  let geometry: [number, number][] | null = null;
  if (r.geometry) {
    try {
      geometry = JSON.parse(r.geometry) as [number, number][];
    } catch {
      geometry = null;
    }
  }

  return {
    id: r.id,
    name: r.name,
    status: r.status,
    startLat: r.startLat,
    startLng: r.startLng,
    startLabel: r.startLabel,
    totalDistanceM: r.totalDistanceM,
    totalDurationS: r.totalDurationS,
    distanceSource: r.distanceSource,
    scheduledFor: r.scheduledFor?.toISOString() ?? null,
    shareToken: r.shareToken,
    notes: r.notes,
    driver: r.driver
      ? { id: r.driver.id, name: r.driver.name, email: r.driver.email, phone: r.driver.phone }
      : null,
    assignedAt: r.assignedAt?.toISOString() ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    stops,
    geometry,
  };
}

export function routeToListItem(r: RouteWithCount): RouteListItemDto {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    stopCount: r._count.stops,
    totalDistanceM: r.totalDistanceM,
    totalDurationS: r.totalDurationS,
    scheduledFor: r.scheduledFor?.toISOString() ?? null,
    driver: r.driver ? { id: r.driver.id, name: r.driver.name } : null,
    createdAt: r.createdAt.toISOString(),
  };
}
