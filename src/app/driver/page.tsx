"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, LoadingBlock } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client";
import { formatDistance, formatDuration } from "@/lib/geo";
import type { Paginated, RouteListItemDto } from "@/lib/types";

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

export default function DriverHomePage() {
  const router = useRouter();
  const [routes, setRoutes] = useState<RouteListItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Paginated<RouteListItemDto>>("/api/routes?pageSize=50")
      .then((data) => {
        if (!cancelled) setRoutes(data.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ClientApiError ? err.message : "Unable to load your routes.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Card padded>
        <EmptyState title="Something went wrong" description={error} />
      </Card>
    );
  }

  if (!routes) return <LoadingBlock label="Loading your routes…" />;

  const active = routes.filter(
    (r) => r.status === "ASSIGNED" || r.status === "IN_PROGRESS",
  );
  const completed = routes.filter((r) => r.status === "COMPLETED");

  if (active.length === 0 && completed.length === 0) {
    return (
      <Card padded>
        <EmptyState
          title="No routes assigned yet"
          description="Check back later — your routes will appear here as soon as they are assigned to you."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Active
        </h2>
        {active.length === 0 ? (
          <Card padded>
            <p className="py-4 text-center text-sm text-gray-500">
              No active routes right now.
            </p>
          </Card>
        ) : (
          active.map((route) => {
            const scheduled = formatDate(route.scheduledFor);
            return (
              <Card key={route.id} padded>
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-gray-900">{route.name}</h3>
                    <Badge value={route.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
                    {scheduled && (
                      <span className="inline-flex items-center gap-1.5">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M8 3v3M16 3v3M4 8h16M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
                        </svg>
                        {scheduled}
                      </span>
                    )}
                    <span>
                      {route.stopCount} {route.stopCount === 1 ? "stop" : "stops"}
                    </span>
                    {route.totalDistanceM != null && (
                      <span>{formatDistance(route.totalDistanceM)}</span>
                    )}
                    {route.totalDurationS != null && (
                      <span>{formatDuration(route.totalDurationS)}</span>
                    )}
                  </div>
                  <Button
                    className="w-full py-3 text-base"
                    onClick={() => router.push(`/driver/routes/${route.id}`)}
                  >
                    Open route
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </section>

      {completed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Completed
          </h2>
          <Card padded={false}>
            <ul className="divide-y divide-gray-100">
              {completed.map((route) => (
                <li key={route.id}>
                  <button
                    onClick={() => router.push(`/driver/routes/${route.id}`)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-gray-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {route.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {route.stopCount} {route.stopCount === 1 ? "stop" : "stops"}
                        {formatDate(route.scheduledFor)
                          ? ` · ${formatDate(route.scheduledFor)}`
                          : ""}
                      </p>
                    </div>
                    <Badge value={route.status} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
