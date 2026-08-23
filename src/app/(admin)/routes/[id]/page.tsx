"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ClientApiError } from "@/lib/client";
import { formatDistance, formatDuration } from "@/lib/geo";
import { fitsSingleNavLink, googleMapsRouteUrl, googleMapsStopUrl } from "@/lib/nav-links";
import type { DriverDto, RouteDto } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  LoadingBlock,
  Select,
  useToast,
} from "@/components/ui";
import { PageHeader } from "@/components/AppShell";
import MapView, { type MapMarker } from "@/components/MapView";

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ClientApiError ? e.message : fallback;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span className="min-w-0 text-right text-sm text-gray-800">{value}</span>
    </div>
  );
}

export default function RouteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [route, setRoute] = useState<RouteDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drivers, setDrivers] = useState<DriverDto[]>([]);
  const [driverSel, setDriverSel] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [unassigning, setUnassigning] = useState(false);

  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [editIds, setEditIds] = useState<string[]>([]);
  const [editDirty, setEditDirty] = useState(false);
  const [savingStops, setSavingStops] = useState<"save" | "reopt" | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* --------------------------------- Loading --------------------------------- */

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await api<RouteDto>(`/api/routes/${id}`);
      setRoute(res);
      setEditIds(res.stops.map((s) => s.shop.id));
      setEditDirty(false);
    } catch (e) {
      setError(errMessage(e, "Failed to load the route"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ items: DriverDto[] }>("/api/drivers")
      .then((res) => setDrivers(res.items.filter((d) => d.status === "ACTIVE")))
      .catch(() => {
        /* assignment select stays empty */
      });
  }, []);

  /* --------------------------------- Actions --------------------------------- */

  const assign = useCallback(
    async (driverId: string | null) => {
      if (!route) return;
      const setter = driverId ? setAssigning : setUnassigning;
      setter(true);
      try {
        await api(`/api/routes/${route.id}/assign`, {
          method: "POST",
          body: JSON.stringify({ driverId }),
        });
        toast("success", driverId ? "Driver assigned and notified" : "Driver unassigned");
        await load();
      } catch (e) {
        toast("error", errMessage(e, "Assignment failed"));
      } finally {
        setter(false);
      }
    },
    [route, toast, load],
  );

  const setStatus = useCallback(
    async (status: string) => {
      if (!route) return;
      setStatusBusy(status);
      if (status === "CANCELLED") setCancelling(true);
      try {
        await api(`/api/routes/${route.id}/status`, {
          method: "POST",
          body: JSON.stringify({ status }),
        });
        toast("success", `Route ${status.replace(/_/g, " ").toLowerCase()}`);
        setCancelOpen(false);
        await load();
      } catch (e) {
        toast("error", errMessage(e, "Status change failed"));
      } finally {
        setStatusBusy(null);
        setCancelling(false);
      }
    },
    [route, toast, load],
  );

  const moveStop = useCallback((index: number, dir: -1 | 1) => {
    setEditIds((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setEditDirty(true);
  }, []);

  const removeStop = useCallback((shopId: string) => {
    setEditIds((prev) => prev.filter((x) => x !== shopId));
    setEditDirty(true);
  }, []);

  const saveStops = useCallback(
    async (reoptimize: boolean) => {
      if (!route || editIds.length === 0) return;
      setSavingStops(reoptimize ? "reopt" : "save");
      try {
        await api(`/api/routes/${route.id}`, {
          method: "PATCH",
          body: JSON.stringify({ shopIds: editIds, reoptimize }),
        });
        toast("success", reoptimize ? "Route re-optimized" : "Stops updated");
        await load();
      } catch (e) {
        toast("error", errMessage(e, "Failed to update stops"));
      } finally {
        setSavingStops(null);
      }
    },
    [route, editIds, toast, load],
  );

  const remove = useCallback(async () => {
    if (!route) return;
    setDeleting(true);
    try {
      await api(`/api/routes/${route.id}`, { method: "DELETE" });
      toast("success", "Route deleted");
      router.push("/routes");
    } catch (e) {
      toast("error", errMessage(e, "Failed to delete the route"));
      setDeleting(false);
    }
  }, [route, toast, router]);

  const copyShareLink = useCallback(async () => {
    if (!route) return;
    const url = `${window.location.origin}/share/${route.shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("success", "Link copied");
    } catch {
      toast("error", "Could not copy the link. Copy it manually: " + url);
    }
  }, [route, toast]);

  /* -------------------------------- Derived UI -------------------------------- */

  const shopById = useMemo(() => {
    const map = new Map<string, RouteDto["stops"][number]["shop"]>();
    for (const stop of route?.stops ?? []) map.set(stop.shop.id, stop.shop);
    return map;
  }, [route]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!route) return [];
    const list: MapMarker[] = [
      {
        id: "__start",
        lat: route.startLat,
        lng: route.startLng,
        label: "S",
        kind: "start",
        title: route.startLabel ?? "Start",
      },
    ];
    for (const stop of route.stops) {
      list.push({
        id: stop.id,
        lat: stop.shop.latitude,
        lng: stop.shop.longitude,
        label: String(stop.sequence),
        kind: "selected",
        title: stop.shop.name,
      });
    }
    return list;
  }, [route]);

  const mapsUrl = useMemo(() => {
    if (!route || !fitsSingleNavLink(route.stops.length)) return null;
    return googleMapsRouteUrl(
      { lat: route.startLat, lng: route.startLng },
      route.stops.map((s) => ({ lat: s.shop.latitude, lng: s.shop.longitude })),
    );
  }, [route]);

  /* ---------------------------------- Render ---------------------------------- */

  if (loading) return <LoadingBlock label="Loading route…" />;

  if (error || !route) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-gray-600">{error ?? "Route not found"}</p>
          <Button variant="secondary" onClick={() => router.push("/routes")}>
            Back to routes
          </Button>
        </div>
      </Card>
    );
  }

  const editable = route.status === "DRAFT" || route.status === "ASSIGNED";
  const description = [
    `${route.stops.length} stop${route.stops.length === 1 ? "" : "s"}`,
    route.totalDistanceM != null ? formatDistance(route.totalDistanceM) : null,
    route.totalDurationS != null ? formatDuration(route.totalDurationS) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <PageHeader
        title={route.name}
        description={description}
        actions={
          <>
            <Badge value={route.status} className="mr-1" />
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
              >
                Open in Google Maps
              </a>
            )}
            <Button variant="secondary" onClick={() => void copyShareLink()}>
              Copy share link
            </Button>
            {route.status === "ASSIGNED" && (
              <Button
                loading={statusBusy === "IN_PROGRESS"}
                onClick={() => void setStatus("IN_PROGRESS")}
              >
                Start route
              </Button>
            )}
            {route.status === "IN_PROGRESS" && (
              <Button
                loading={statusBusy === "COMPLETED"}
                onClick={() => void setStatus("COMPLETED")}
              >
                Complete route
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Left column (2/3): map + stops */}
        <div className="space-y-6 xl:col-span-2">
          <MapView
            markers={markers}
            polyline={route.geometry}
            height="480px"
            fitKey={`${route.id}-${route.stops.length}-${route.updatedAt}`}
          />

          <Card title={`Stops (${route.stops.length})`} padded={false}>
            {route.stops.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">
                This route has no stops.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      <th className="px-5 py-2.5">#</th>
                      <th className="px-3 py-2.5">Shop</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5">Leg</th>
                      <th className="px-5 py-2.5 text-right">Navigate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {route.stops.map((stop) => (
                      <tr key={stop.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-5 py-3 font-semibold text-gray-500">{stop.sequence}</td>
                        <td className="px-3 py-3">
                          <p className="font-medium text-gray-900">{stop.shop.name}</p>
                          {stop.shop.address && (
                            <p className="text-xs text-gray-500">{stop.shop.address}</p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Badge value={stop.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-700">
                          {stop.legDistanceM != null ? formatDistance(stop.legDistanceM) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <a
                            href={googleMapsStopUrl({
                              lat: stop.shop.latitude,
                              lng: stop.shop.longitude,
                            })}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded p-1.5 text-blue-600 hover:bg-blue-50"
                            aria-label={`Navigate to ${stop.shop.name}`}
                            title="Open in Google Maps"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 11l19-9-9 19-2-8-8-2z" />
                            </svg>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right column (1/3): assignment, details, status, edit stops */}
        <div className="space-y-6">
          <Card title="Assignment">
            {route.driver ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-gray-50 px-3 py-2.5">
                  <p className="text-sm font-medium text-gray-900">{route.driver.name}</p>
                  <p className="text-xs text-gray-500">{route.driver.email}</p>
                  {route.driver.phone && (
                    <p className="text-xs text-gray-500">{route.driver.phone}</p>
                  )}
                  {route.assignedAt && (
                    <p className="mt-1 text-xs text-gray-400">
                      Assigned {formatDateTime(route.assignedAt)}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  loading={unassigning}
                  onClick={() => void assign(null)}
                >
                  Unassign driver
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">No driver assigned yet.</p>
                <Select
                  value={driverSel}
                  onChange={(e) => setDriverSel(e.target.value)}
                  aria-label="Select a driver"
                >
                  <option value="">Select a driver…</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.activeRouteCount ? ` (${d.activeRouteCount} active)` : ""}
                    </option>
                  ))}
                </Select>
                <Button
                  loading={assigning}
                  disabled={!driverSel}
                  onClick={() => void assign(driverSel)}
                  className="w-full"
                >
                  Assign &amp; notify
                </Button>
              </div>
            )}
          </Card>

          <Card title="Details">
            <div className="divide-y divide-gray-50">
              <DetailRow
                label="Start"
                value={
                  <>
                    {route.startLabel && <span className="block">{route.startLabel}</span>}
                    <span className="block text-xs text-gray-400">
                      {route.startLat.toFixed(5)}, {route.startLng.toFixed(5)}
                    </span>
                  </>
                }
              />
              <DetailRow label="Scheduled" value={formatDateTime(route.scheduledFor)} />
              <DetailRow label="Created" value={formatDateTime(route.createdAt)} />
              {route.notes && <DetailRow label="Notes" value={route.notes} />}
              <DetailRow
                label="Distances"
                value={
                  route.distanceSource === "OSRM"
                    ? "Road network (OSRM)"
                    : route.distanceSource
                      ? "Straight-line estimate"
                      : "—"
                }
              />
            </div>
          </Card>

          <Card title="Status">
            <div className="space-y-3">
              <Badge value={route.status} />
              <div className="flex flex-wrap gap-2">
                {route.status === "ASSIGNED" && (
                  <Button
                    loading={statusBusy === "IN_PROGRESS"}
                    onClick={() => void setStatus("IN_PROGRESS")}
                  >
                    Start
                  </Button>
                )}
                {route.status === "IN_PROGRESS" && (
                  <Button
                    loading={statusBusy === "COMPLETED"}
                    onClick={() => void setStatus("COMPLETED")}
                  >
                    Complete
                  </Button>
                )}
                {route.status === "CANCELLED" && (
                  <Button
                    variant="secondary"
                    loading={statusBusy === "DRAFT" || statusBusy === "ASSIGNED"}
                    onClick={() => void setStatus(route.driver ? "ASSIGNED" : "DRAFT")}
                  >
                    Reopen
                  </Button>
                )}
                {(route.status === "DRAFT" ||
                  route.status === "ASSIGNED" ||
                  route.status === "IN_PROGRESS") && (
                  <Button variant="danger" onClick={() => setCancelOpen(true)}>
                    Cancel route
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {editable && (
            <Card title="Edit stops">
              <div className="space-y-3">
                <p className="text-xs text-amber-700">
                  Editing stops resets any stop progress on this route.
                </p>
                {editIds.length === 0 ? (
                  <p className="text-sm text-gray-500">All stops removed — add stops by re-creating the route.</p>
                ) : (
                  <ol className="divide-y divide-gray-50 rounded-lg border border-gray-200">
                    {editIds.map((shopId, i) => {
                      const shop = shopById.get(shopId);
                      return (
                        <li key={shopId} className="flex items-center gap-2.5 px-3 py-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                            {shop?.name ?? shopId}
                          </span>
                          <span className="flex shrink-0 items-center gap-0.5">
                            <button
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                              aria-label="Move up"
                              disabled={i === 0}
                              onClick={() => moveStop(i, -1)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M12 19V5M5 12l7-7 7 7" />
                              </svg>
                            </button>
                            <button
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                              aria-label="Move down"
                              disabled={i === editIds.length - 1}
                              onClick={() => moveStop(i, 1)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M12 5v14M19 12l-7 7-7-7" />
                              </svg>
                            </button>
                            <button
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                              aria-label="Remove stop"
                              disabled={editIds.length <= 1}
                              onClick={() => removeStop(shopId)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M6 6l12 12M18 6L6 18" />
                              </svg>
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    loading={savingStops === "reopt"}
                    disabled={editIds.length === 0 || savingStops !== null}
                    onClick={() => void saveStops(true)}
                  >
                    Re-optimize
                  </Button>
                  <Button
                    loading={savingStops === "save"}
                    disabled={!editDirty || editIds.length === 0 || savingStops !== null}
                    onClick={() => void saveStops(false)}
                  >
                    Save changes
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <div className="flex justify-end">
            <Button
              variant="ghost"
              className="text-red-600 hover:bg-red-50"
              onClick={() => setDeleteOpen(true)}
            >
              Delete route
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel route"
        message={`Cancel "${route.name}"? The driver will no longer be able to work this route.`}
        confirmLabel="Cancel route"
        danger
        loading={cancelling}
        onConfirm={() => void setStatus("CANCELLED")}
        onCancel={() => setCancelOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete route"
        message={`Delete "${route.name}"? This removes the route and its stops. This cannot be undone from the app.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
