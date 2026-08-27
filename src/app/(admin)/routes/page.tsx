"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ClientApiError } from "@/lib/client";
import { formatDistance, formatDuration } from "@/lib/geo";
import type { DriverDto, Paginated, RouteListItemDto } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingBlock,
  Pagination,
  Select,
} from "@/components/ui";
import { PageHeader } from "@/components/AppShell";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

/** Link styled exactly like a primary/secondary Button. */
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
      ? "bg-brand text-white hover:bg-brand-strong shadow-sm"
      : "bg-white text-ink border border-black/10 hover:bg-black/[0.03]";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4.5 py-2 text-sm font-medium transition-colors ${styles}`}
    >
      {children}
    </Link>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function RoutesPage() {
  const [status, setStatus] = useState("ALL");
  const [driverId, setDriverId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<RouteListItemDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverDto[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, page: String(page) });
      if (driverId) params.set("driverId", driverId);
      if (query.trim()) params.set("q", query.trim());
      const res = await api<Paginated<RouteListItemDto>>(`/api/routes?${params.toString()}`);
      setData(res);
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Failed to load routes");
    } finally {
      setLoading(false);
    }
  }, [status, driverId, query, page]);

  // Debounce so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    api<{ items: DriverDto[] }>("/api/drivers")
      .then((res) => setDrivers(res.items))
      .catch(() => {
        /* driver filter stays empty; routes still load */
      });
  }, []);

  const routes = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Routes"
        description="Plan, assign and track delivery routes"
        actions={<LinkButton href="/routes/new">New route</LinkButton>}
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-gray-100 px-5 py-3.5">
          <div className="w-full min-w-40 sm:w-64">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search routes…"
              aria-label="Search routes by name"
            />
          </div>
          <div className="w-40">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Select
              value={driverId}
              onChange={(e) => {
                setDriverId(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by driver"
            >
              <option value="">All drivers</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          {(query || status !== "ALL" || driverId) && (
            <button
              className="text-xs font-medium text-gray-500 hover:text-gray-800 hover:underline"
              onClick={() => {
                setQuery("");
                setStatus("ALL");
                setDriverId("");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          )}
          {data && !loading && (
            <span className="ml-auto text-xs text-gray-400">
              {data.total} route{data.total === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {loading && <LoadingBlock label="Loading routes…" />}

        {!loading && error && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-gray-600">{error}</p>
            <Button variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && routes.length === 0 && (
          query || status !== "ALL" || driverId ? (
            <EmptyState
              title="No routes match"
              description="Try a different search or clear the filters."
            />
          ) : (
            <EmptyState
              title="No routes yet"
              description="Plan your first route to start dispatching drivers to shops."
              action={<LinkButton href="/routes/new">New route</LinkButton>}
            />
          )
        )}

        {!loading && !error && routes.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-5 py-2.5">Name</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Stops</th>
                    <th className="px-3 py-2.5">Distance</th>
                    <th className="px-3 py-2.5">Duration</th>
                    <th className="px-3 py-2.5">Driver</th>
                    <th className="px-3 py-2.5">Scheduled</th>
                    <th className="px-5 py-2.5 text-right">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/routes/${route.id}`}
                          className="font-medium text-brand hover:text-brand-strong hover:underline"
                        >
                          {route.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Badge value={route.status} />
                      </td>
                      <td className="px-3 py-3 text-gray-700">{route.stopCount}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-700">
                        {route.totalDistanceM != null ? formatDistance(route.totalDistanceM) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-700">
                        {route.totalDurationS != null ? formatDuration(route.totalDurationS) : "—"}
                      </td>
                      <td className="px-3 py-3 text-gray-700">{route.driver?.name ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-700">
                        {formatDate(route.scheduledFor)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-gray-500">
                        {formatDate(route.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPage={setPage}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
