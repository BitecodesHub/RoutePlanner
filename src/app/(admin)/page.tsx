"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ClientApiError } from "@/lib/client";
import { formatDistance, formatDuration } from "@/lib/geo";
import type { DashboardStatsDto } from "@/lib/types";
import { Badge, Button, Card, EmptyState, LoadingBlock } from "@/components/ui";
import { PageHeader } from "@/components/AppShell";

/* ------------------------------ Helpers ----------------------------------- */

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffS = Math.floor((Date.now() - then) / 1000);
  if (diffS < 60) return "just now";
  const m = Math.floor(diffS / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(then).toLocaleDateString();
}

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.password_change": "Password changed",
  "auth.password_reset": "Password reset",
  "shop.create": "Shop created",
  "shop.update": "Shop updated",
  "shop.delete": "Shop deleted",
  "shop.import": "Shops imported",
  "driver.create": "Driver created",
  "driver.update": "Driver updated",
  "driver.delete": "Driver deleted",
  "route.create": "Route created",
  "route.update": "Route updated",
  "route.delete": "Route deleted",
  "route.assign": "Route assigned",
  "route.unassign": "Route unassigned",
  "route.status": "Route status changed",
  "route.start": "Route started",
  "route.complete": "Route completed",
  "route.cancel": "Route cancelled",
  "stop.status": "Stop status changed",
};

function prettifyAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const [entity, verb] = action.split(".");
  if (entity && verb) {
    const label = entity.charAt(0).toUpperCase() + entity.slice(1);
    const past = verb.endsWith("e") ? `${verb}d` : `${verb}ed`;
    return `${label} ${past}`;
  }
  return action.replace(/[._]/g, " ");
}

/** Link that looks exactly like a Button (avoids nesting a button in an anchor). */
function LinkButton({
  href,
  variant = "primary",
  children,
}: {
  href: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
}) {
  const styles =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
      : "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${styles}`}
    >
      {children}
    </Link>
  );
}

function StatIcon({ d }: { d: string }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} />
      </svg>
    </span>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <Card className="flex-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold text-gray-900">{value}</p>
          <p className="mt-0.5 text-xs font-medium text-gray-500">{label}</p>
        </div>
        <StatIcon d={icon} />
      </div>
    </Card>
  );
}

/* ------------------------------ Page --------------------------------------- */

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStatsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<DashboardStatsDto>("/api/dashboard/stats");
      setStats(data);
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Operational overview"
        actions={
          <>
            <LinkButton href="/shops?import=1" variant="secondary">
              Import shops
            </LinkButton>
            <LinkButton href="/routes/new">New route</LinkButton>
          </>
        }
      />

      {loading && <LoadingBlock label="Loading dashboard…" />}

      {!loading && error && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-gray-600">{error}</p>
            <Button variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && stats && (
        <div className="space-y-6">
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <StatCard
              label="Total shops"
              value={stats.totalShops}
              icon="M3 9l1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6"
            />
            <StatCard
              label="Active drivers"
              value={stats.activeDrivers}
              icon="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"
            />
            <StatCard
              label="Routes created"
              value={stats.totalRoutes}
              icon="M6 20a2 2 0 100-4 2 2 0 000 4zm12-12a2 2 0 100-4 2 2 0 000 4zM8 18h7a4 4 0 000-8H9a4 4 0 010-4"
            />
            <StatCard
              label="Active routes"
              value={stats.activeRoutes}
              icon="M13 2L3 14h7l-1 8 10-12h-7l1-8z"
            />
            <StatCard
              label="Completed routes"
              value={stats.completedRoutes}
              icon="M22 11.1V12a10 10 0 11-5.93-9.14M22 4L12 14l-3-3"
            />
          </div>

          {/* Two-column detail grid */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Recent routes" padded={false}>
              {stats.recentRoutes.length === 0 ? (
                <EmptyState
                  title="No routes yet"
                  description="Create a route to start dispatching drivers to shops."
                  action={<LinkButton href="/routes/new">Plan your first route</LinkButton>}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                        <th className="px-5 py-2.5">Route</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Stops</th>
                        <th className="px-3 py-2.5">Distance</th>
                        <th className="px-3 py-2.5">Driver</th>
                        <th className="px-5 py-2.5 text-right">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentRoutes.map((route) => (
                        <tr key={route.id} className="border-b border-gray-50 last:border-0">
                          <td className="px-5 py-3">
                            <Link
                              href={`/routes/${route.id}`}
                              className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              {route.name}
                            </Link>
                          </td>
                          <td className="px-3 py-3">
                            <Badge value={route.status} />
                          </td>
                          <td className="px-3 py-3 text-gray-700">{route.stopCount}</td>
                          <td className="px-3 py-3 text-gray-700">
                            {route.totalDistanceM != null ? (
                              <span>
                                {formatDistance(route.totalDistanceM)}
                                {route.totalDurationS != null && (
                                  <span className="block text-xs text-gray-400">
                                    {formatDuration(route.totalDurationS)}
                                  </span>
                                )}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-3 text-gray-700">{route.driver?.name ?? "—"}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-gray-500">
                            {timeAgo(route.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="space-y-6">
              <Card title="Recent imports" padded={false}>
                {stats.recentImports.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-gray-500">No imports yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {stats.recentImports.map((imp) => (
                      <li key={imp.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">{imp.filename}</p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {imp.imported} imported · {imp.invalid} invalid · {imp.skippedDuplicates}{" "}
                            skipped
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">{timeAgo(imp.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Recent activity" padded={false}>
                {stats.recentActivity.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-gray-500">No activity yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {stats.recentActivity.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-gray-900">{prettifyAction(entry.action)}</p>
                          <p className="mt-0.5 text-xs text-gray-500">{entry.userName ?? "System"}</p>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">{timeAgo(entry.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
