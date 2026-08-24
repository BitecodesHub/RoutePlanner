"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import MapView, { type MapMarker } from "@/components/MapView";
import { Badge, LoadingBlock } from "@/components/ui";
import { api } from "@/lib/client";
import { formatDistance, formatDuration } from "@/lib/geo";
import { fitsSingleNavLink, googleMapsRouteUrl } from "@/lib/nav-links";
import type { RouteDto } from "@/lib/types";

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

export default function SharedRoutePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [route, setRoute] = useState<RouteDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<RouteDto>(`/api/share/${token}`)
      .then((data) => {
        if (!cancelled) setRoute(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!route) return [];
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
        kind: "shop",
        title: stop.shop.name,
      });
    }
    return list;
  }, [route]);

  if (failed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white shadow-sm">
            R
          </div>
          <h1 className="text-base font-semibold text-gray-900">
            This link is invalid or the route was removed.
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Please ask the sender for a new link.
          </p>
        </div>
      </main>
    );
  }

  if (!route) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100">
        <LoadingBlock label="Loading route…" />
      </main>
    );
  }

  const scheduled = formatDate(route.scheduledFor);
  const mapsUrl = fitsSingleNavLink(route.stops.length)
    ? googleMapsRouteUrl(
        { lat: route.startLat, lng: route.startLng },
        route.stops.map((s) => ({ lat: s.shop.latitude, lng: s.shop.longitude })),
      )
    : null;
  const driverFirstName = route.driver?.name.split(" ")[0] ?? null;

  return (
    <div className="min-h-screen bg-canvas">
      {/* Slim top bar */}
      <header className="sticky top-0 z-40 flex items-center gap-3 bg-canvas/75 px-4 py-3.5 backdrop-blur-xl md:px-8">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 20a2 2 0 100-4 2 2 0 000 4zm12-12a2 2 0 100-4 2 2 0 000 4zM8 18h7a4 4 0 000-8H9a4 4 0 010-4" />
          </svg>
        </div>
        <span className="truncate text-sm font-semibold text-ink">{route.name}</span>
        <Badge value={route.status} className="ml-auto shrink-0" />
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {/* Totals strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-black/[0.05] bg-white p-3 text-center shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <p className="text-lg font-semibold text-gray-900">{route.stops.length}</p>
            <p className="text-xs text-gray-500">
              {route.stops.length === 1 ? "Stop" : "Stops"}
            </p>
          </div>
          <div className="rounded-2xl border border-black/[0.05] bg-white p-3 text-center shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <p className="text-lg font-semibold text-gray-900">
              {route.totalDistanceM != null ? formatDistance(route.totalDistanceM) : "—"}
            </p>
            <p className="text-xs text-gray-500">Distance</p>
          </div>
          <div className="rounded-2xl border border-black/[0.05] bg-white p-3 text-center shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <p className="text-lg font-semibold text-gray-900">
              {route.totalDurationS != null ? formatDuration(route.totalDurationS) : "—"}
            </p>
            <p className="text-xs text-gray-500">Duration</p>
          </div>
          <div className="rounded-2xl border border-black/[0.05] bg-white p-3 text-center shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <p className="text-lg font-semibold text-gray-900">{scheduled ?? "—"}</p>
            <p className="text-xs text-gray-500">Scheduled</p>
          </div>
        </div>

        {driverFirstName && (
          <p className="text-sm text-gray-600">
            Assigned to <span className="font-medium text-gray-900">{driverFirstName}</span>
          </p>
        )}

        {/* Map */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <MapView
            markers={markers}
            polyline={route.geometry}
            height="60vh"
            fitKey={route.id}
          />
        </div>

        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4.5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-strong"
          >
            Open in Google Maps
          </a>
        ) : (
          <p className="text-center text-xs text-gray-500">
            Route too long for one Maps link.
          </p>
        )}

        {/* Ordered stop list */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-gray-900">Stops in order</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {route.stops.map((stop) => (
              <li key={stop.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">
                  {stop.sequence}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {stop.shop.name}
                  </p>
                  {stop.shop.address && (
                    <p className="truncate text-xs text-gray-500">{stop.shop.address}</p>
                  )}
                </div>
                {stop.legDistanceM != null && (
                  <span className="shrink-0 text-xs text-gray-500">
                    {formatDistance(stop.legDistanceM)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <p className="pb-4 text-center text-xs text-gray-400">
          Shared via RoutePilot
        </p>
      </main>
    </div>
  );
}
