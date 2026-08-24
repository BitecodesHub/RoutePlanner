"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import MapView, { type MapMarker } from "@/components/MapView";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  LoadingBlock,
  useToast,
} from "@/components/ui";
import { api, ClientApiError } from "@/lib/client";
import { formatDistance, formatDuration } from "@/lib/geo";
import { fitsSingleNavLink, googleMapsRouteUrl, googleMapsStopUrl } from "@/lib/nav-links";
import type { RouteDto, RouteStopDto } from "@/lib/types";

const TERMINAL_STOP_STATUSES = new Set(["COMPLETED", "SKIPPED"]);

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Anchor styled to match the secondary Button. */
function NavLinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-black/[0.03]"
    >
      {children}
    </a>
  );
}

export default function DriverRoutePage() {
  const params = useParams<{ id: string }>();
  const routeId = params.id;
  const { toast } = useToast();

  const [route, setRoute] = useState<RouteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [busyStopId, setBusyStopId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const data = await api<RouteDto>(`/api/routes/${routeId}`);
      setRoute(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ClientApiError ? err.message : "Unable to load this route.",
      );
    }
  }, [routeId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const unfinishedCount = useMemo(
    () =>
      route
        ? route.stops.filter((s) => !TERMINAL_STOP_STATUSES.has(s.status)).length
        : 0,
    [route],
  );

  const markers = useMemo<MapMarker[]>(() => {
    if (!route) return [];
    const nextStop = route.stops.find((s) => !TERMINAL_STOP_STATUSES.has(s.status));
    const list: MapMarker[] = [
      {
        id: "start",
        lat: route.startLat,
        lng: route.startLng,
        label: "S",
        kind: "start",
        title: route.startLabel ?? "Start point",
      },
    ];
    for (const stop of route.stops) {
      list.push({
        id: stop.id,
        lat: stop.shop.latitude,
        lng: stop.shop.longitude,
        label: String(stop.sequence),
        kind: nextStop && stop.id === nextStop.id ? "selected" : "shop",
        title: stop.shop.name,
      });
    }
    return list;
  }, [route]);

  async function changeRouteStatus(status: "IN_PROGRESS" | "COMPLETED") {
    setStatusLoading(true);
    try {
      await api(`/api/routes/${routeId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setConfirmComplete(false);
      await refetch();
      toast(
        "success",
        status === "IN_PROGRESS" ? "Route started. Drive safe!" : "Route completed. Well done!",
      );
    } catch (err) {
      toast(
        "error",
        err instanceof ClientApiError ? err.message : "Unable to update the route.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  async function changeStopStatus(stop: RouteStopDto, status: "ARRIVED" | "COMPLETED" | "SKIPPED") {
    setBusyStopId(stop.id);
    try {
      await api(`/api/routes/${routeId}/stops/${stop.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refetch();
    } catch (err) {
      toast(
        "error",
        err instanceof ClientApiError ? err.message : "Unable to update the stop.",
      );
    } finally {
      setBusyStopId(null);
    }
  }

  function handleCompleteRoute() {
    if (unfinishedCount > 0) {
      setConfirmComplete(true);
    } else {
      void changeRouteStatus("COMPLETED");
    }
  }

  if (error) {
    return (
      <Card padded>
        <EmptyState title="Route unavailable" description={error} />
      </Card>
    );
  }

  if (!route) return <LoadingBlock label="Loading route…" />;

  const scheduled = formatDate(route.scheduledFor);
  const inProgress = route.status === "IN_PROGRESS";
  const allTerminal = route.stops.length > 0 && unfinishedCount === 0;
  // The first stop that is not finished yet — the driver's next destination.
  const nextStop = route.stops.find(
    (s) => s.status === "PENDING" || s.status === "ARRIVED",
  );
  const mapsUrl = fitsSingleNavLink(route.stops.length)
    ? googleMapsRouteUrl(
        { lat: route.startLat, lng: route.startLng },
        route.stops.map((s) => ({ lat: s.shop.latitude, lng: s.shop.longitude })),
      )
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-gray-900">{route.name}</h1>
          <Badge value={route.status} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
          <span>
            {route.stops.length} {route.stops.length === 1 ? "stop" : "stops"}
          </span>
          {route.totalDistanceM != null && <span>{formatDistance(route.totalDistanceM)}</span>}
          {route.totalDurationS != null && <span>{formatDuration(route.totalDurationS)}</span>}
          {scheduled && <span>Scheduled {scheduled}</span>}
        </div>
        {route.startLabel && (
          <p className="text-xs text-gray-500">Starts from {route.startLabel}</p>
        )}
      </div>

      {/* Primary actions */}
      <div className="space-y-2">
        {route.status === "ASSIGNED" && (
          <Button
            className="w-full py-3 text-base"
            loading={statusLoading}
            onClick={() => void changeRouteStatus("IN_PROGRESS")}
          >
            Start route
          </Button>
        )}
        {inProgress && (
          <>
            {nextStop && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-brand/25 bg-brand-soft px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-brand">
                    Next stop
                  </p>
                  <p className="truncate text-sm font-semibold text-ink">
                    {nextStop.sequence}. {nextStop.shop.name}
                  </p>
                </div>
                <a
                  href={googleMapsStopUrl({
                    lat: nextStop.shop.latitude,
                    lng: nextStop.shop.longitude,
                  })}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-full bg-brand px-4.5 py-2 text-sm font-medium text-white hover:bg-brand-strong"
                >
                  Navigate
                </a>
              </div>
            )}
            {allTerminal && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                All stops are finished — you can complete the route now.
              </div>
            )}
            <Button
              className="w-full py-3 text-base"
              loading={statusLoading}
              onClick={handleCompleteRoute}
            >
              Complete route
            </Button>
          </>
        )}
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4.5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-black/[0.03]"
          >
            Open full route in Google Maps
          </a>
        ) : (
          <p className="text-center text-xs text-gray-500">
            Route too long for one Maps link — navigate stop by stop below.
          </p>
        )}
      </div>

      {/* Map */}
      <Card padded={false} className="overflow-hidden">
        <MapView
          markers={markers}
          polyline={route.geometry}
          height="320px"
          fitKey={route.id}
        />
      </Card>

      {/* Stop checklist */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Stops
        </h2>
        {route.stops.map((stop) => {
          const terminal = TERMINAL_STOP_STATUSES.has(stop.status);
          const done = stop.status === "COMPLETED";
          return (
            <Card key={stop.id} padded className={terminal ? "opacity-60" : ""}>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      done
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-brand-soft text-brand-strong"
                    }`}
                  >
                    {done ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      stop.sequence
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">{stop.shop.name}</p>
                      <Badge value={stop.status} />
                    </div>
                    {stop.shop.address && (
                      <p className="mt-0.5 text-sm text-gray-600">{stop.shop.address}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                      {stop.shop.phone && (
                        <a
                          href={`tel:${stop.shop.phone}`}
                          className="font-medium text-brand hover:text-brand-strong"
                        >
                          {stop.shop.phone}
                        </a>
                      )}
                      {stop.legDistanceM != null && (
                        <span>{formatDistance(stop.legDistanceM)} leg</span>
                      )}
                    </div>
                  </div>
                </div>

                {inProgress && !terminal && (
                  <div className="flex flex-wrap gap-2">
                    <NavLinkButton
                      href={googleMapsStopUrl({
                        lat: stop.shop.latitude,
                        lng: stop.shop.longitude,
                      })}
                    >
                      Navigate
                    </NavLinkButton>
                    {stop.status === "PENDING" && (
                      <Button
                        variant="secondary"
                        loading={busyStopId === stop.id}
                        onClick={() => void changeStopStatus(stop, "ARRIVED")}
                      >
                        Arrived
                      </Button>
                    )}
                    <Button
                      loading={busyStopId === stop.id}
                      onClick={() => void changeStopStatus(stop, "COMPLETED")}
                    >
                      Done
                    </Button>
                    <Button
                      variant="ghost"
                      loading={busyStopId === stop.id}
                      onClick={() => void changeStopStatus(stop, "SKIPPED")}
                    >
                      Skip
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmComplete}
        title="Complete route?"
        message={`${unfinishedCount} ${unfinishedCount === 1 ? "stop is" : "stops are"} not finished yet. Complete the route anyway?`}
        confirmLabel="Complete route"
        loading={statusLoading}
        onConfirm={() => void changeRouteStatus("COMPLETED")}
        onCancel={() => setConfirmComplete(false)}
      />
    </div>
  );
}
