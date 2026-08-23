/** Shared DTO shapes returned by the API (client-safe, no Prisma types). */

export interface ShopDto {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  externalRef: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DriverDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  activeRouteCount?: number;
}

export interface RouteStopDto {
  id: string;
  sequence: number;
  status: string;
  legDistanceM: number | null;
  legDurationS: number | null;
  arrivedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  shop: ShopDto;
}

export interface RouteDto {
  id: string;
  name: string;
  status: string;
  startLat: number;
  startLng: number;
  startLabel: string | null;
  totalDistanceM: number | null;
  totalDurationS: number | null;
  distanceSource: string | null;
  scheduledFor: string | null;
  shareToken: string;
  notes: string | null;
  driver: { id: string; name: string; email: string; phone: string | null } | null;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stops: RouteStopDto[];
  /** [lat,lng] pairs for the map polyline. */
  geometry: [number, number][] | null;
}

export interface RouteListItemDto {
  id: string;
  name: string;
  status: string;
  stopCount: number;
  totalDistanceM: number | null;
  totalDurationS: number | null;
  scheduledFor: string | null;
  driver: { id: string; name: string } | null;
  createdAt: string;
}

export interface ImportSummaryDto {
  batchId: string;
  filename: string;
  totalRows: number;
  imported: number;
  skippedDuplicates: number;
  invalid: number;
  errors: { rowNumber: number; message: string }[];
}

export interface DashboardStatsDto {
  totalShops: number;
  activeDrivers: number;
  totalRoutes: number;
  activeRoutes: number;
  completedRoutes: number;
  recentRoutes: RouteListItemDto[];
  recentImports: {
    id: string;
    filename: string;
    imported: number;
    invalid: number;
    skippedDuplicates: number;
    createdAt: string;
  }[];
  recentActivity: {
    id: string;
    action: string;
    entity: string | null;
    detail: string | null;
    createdAt: string;
    userName: string | null;
  }[];
}

export interface SessionDto {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "DRIVER";
  mustChangePassword: boolean;
}

export interface GeocodeResultDto {
  label: string;
  lat: number;
  lng: number;
}

export interface OptimizePreviewDto {
  orderedShopIds: string[];
  totalDistanceM: number;
  totalDurationS: number;
  distanceSource: string;
  geometry: [number, number][];
  legs: { shopId: string; legDistanceM: number; legDurationS: number }[];
}
