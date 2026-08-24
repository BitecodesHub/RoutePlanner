"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, ClientApiError } from "@/lib/client";
import { formatDistance, formatDuration, haversineMeters } from "@/lib/geo";
import type {
  GeocodeResultDto,
  OptimizePreviewDto,
  Paginated,
  RouteDto,
  ShopDto,
} from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  LoadingBlock,
  Select,
  Spinner,
  Textarea,
  useToast,
} from "@/components/ui";
import { PageHeader } from "@/components/AppShell";
import MapView, { type MapMarker } from "@/components/MapView";

interface StartPoint {
  lat: number;
  lng: number;
  label?: string;
}

interface GeocodeResponse {
  result: GeocodeResultDto | null;
  candidates?: GeocodeResultDto[];
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ClientApiError ? e.message : fallback;
}

/** Numbered step section; content is dimmed and inert until enabled. */
function StepSection({
  step,
  title,
  enabled,
  done,
  children,
}: {
  step: number;
  title: string;
  enabled: boolean;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={enabled ? "" : "opacity-60"}>
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? "bg-emerald-600 text-white"
              : enabled
                ? "bg-brand text-white"
                : "bg-gray-200 text-gray-500"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <div className={enabled ? "" : "pointer-events-none select-none"}>{children}</div>
    </Card>
  );
}

export default function NewRoutePage() {
  const router = useRouter();
  const { toast } = useToast();

  /* ------------------------------ Step 1: start ----------------------------- */
  const [startInput, setStartInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [candidates, setCandidates] = useState<GeocodeResultDto[] | null>(null);
  const [start, setStart] = useState<StartPoint | null>(null);

  /* ------------------------------ Step 2: shops ------------------------------ */
  const [shopQuery, setShopQuery] = useState("");
  const [shops, setShops] = useState<ShopDto[]>([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Every shop ever seen, so selections survive changing the search filter. */
  const shopCache = useRef<Map<string, ShopDto>>(new Map());

  /* ----------------------------- Step 3: optimize ---------------------------- */
  const [preview, setPreview] = useState<OptimizePreviewDto | null>(null);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [manualDirty, setManualDirty] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  /* ------------------------------- Step 4: save ------------------------------ */
  const [name, setName] = useState(
    () =>
      `Route ${new Date().toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`,
  );
  const [scheduledFor, setScheduledFor] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([]);
  const [assignDriverId, setAssignDriverId] = useState("");
  /** Last used starting point, remembered across sessions for one-click reuse. */
  const [lastStart, setLastStart] = useState<StartPoint | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /* --------------------------------- Loaders --------------------------------- */

  // Restore the remembered starting point and load active drivers once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("rp:lastStart");
      if (raw) {
        const p = JSON.parse(raw) as StartPoint;
        if (typeof p.lat === "number" && typeof p.lng === "number") setLastStart(p);
      }
    } catch {
      /* corrupt storage — ignore */
    }
    void (async () => {
      try {
        const res = await api<{ items: { id: string; name: string; status: string }[] }>(
          "/api/drivers",
        );
        setDrivers(res.items.filter((d) => d.status === "ACTIVE"));
      } catch {
        /* driver list is optional here — assignment also works from the route page */
      }
    })();
  }, []);

  useEffect(() => {
    if (!start) return;
    let cancelled = false;
    setShopsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ pageSize: "200", status: "ACTIVE" });
        if (shopQuery.trim()) params.set("q", shopQuery.trim());
        const res = await api<Paginated<ShopDto>>(`/api/shops?${params.toString()}`);
        if (cancelled) return;
        for (const s of res.items) shopCache.current.set(s.id, s);
        setShops(res.items);
      } catch (e) {
        if (!cancelled) toast("error", errMessage(e, "Failed to load shops"));
      } finally {
        if (!cancelled) setShopsLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [start, shopQuery, toast]);

  /* --------------------------------- Actions --------------------------------- */

  // Monotonic token: any selection/start change invalidates in-flight
  // optimisation responses so a stale result can never overwrite new state.
  const optimizeSeq = useRef(0);

  const chooseStart = useCallback((p: StartPoint) => {
    optimizeSeq.current++;
    setOptimizing(false);
    setStart(p);
    setCandidates(null);
    // A new origin invalidates any previous optimisation.
    setPreview(null);
    setOrderedIds([]);
    setManualDirty(false);
    setLastStart(p);
    try {
      localStorage.setItem("rp:lastStart", JSON.stringify(p));
    } catch {
      /* storage unavailable — feature degrades silently */
    }
  }, []);

  const resolveStart = useCallback(async () => {
    const input = startInput.trim();
    if (!input) return;
    setResolving(true);
    setCandidates(null);
    try {
      const res = await api<GeocodeResponse>("/api/geocode", {
        method: "POST",
        body: JSON.stringify({ input }),
      });
      if (res.result) {
        chooseStart({ lat: res.result.lat, lng: res.result.lng, label: res.result.label });
      } else if (res.candidates && res.candidates.length > 0) {
        setCandidates(res.candidates);
      } else {
        toast("error", "Could not resolve that location. Try an address or \"lat,lng\".");
      }
    } catch (e) {
      toast("error", errMessage(e, "Failed to resolve the starting point"));
    } finally {
      setResolving(false);
    }
  }, [startInput, chooseStart, toast]);

  const useMyLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      toast("error", "Geolocation is not available in this browser");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        chooseStart({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "My location",
        });
      },
      () => {
        setLocating(false);
        toast("error", "Could not read your location. Check browser permissions.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [chooseStart, toast]);

  /** Toggling a shop invalidates the current optimisation preview. */
  const toggleShop = useCallback((id: string) => {
    optimizeSeq.current++;
    setOptimizing(false);
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setPreview(null);
    setOrderedIds([]);
    setManualDirty(false);
  }, []);

  /** Select every shop currently shown (respects the active search filter). */
  const selectAllShown = useCallback(() => {
    optimizeSeq.current++;
    setOptimizing(false);
    setSelectedIds((prev) => {
      const merged = new Set(prev);
      for (const s of shops) merged.add(s.id);
      return [...merged].slice(0, 200);
    });
    setPreview(null);
    setOrderedIds([]);
    setManualDirty(false);
  }, [shops]);

  const clearSelection = useCallback(() => {
    optimizeSeq.current++;
    setOptimizing(false);
    setSelectedIds([]);
    setPreview(null);
    setOrderedIds([]);
    setManualDirty(false);
  }, []);

  const optimize = useCallback(async () => {
    if (!start || selectedIds.length === 0) return;
    const token = ++optimizeSeq.current;
    setOptimizing(true);
    try {
      const ids = preview && orderedIds.length > 0 ? orderedIds : selectedIds;
      const res = await api<OptimizePreviewDto>("/api/optimize/preview", {
        method: "POST",
        body: JSON.stringify({
          start: { lat: start.lat, lng: start.lng, label: start.label },
          shopIds: ids,
        }),
      });
      // Selection changed while the request was in flight — drop the result.
      if (token !== optimizeSeq.current) return;
      setPreview(res);
      setOrderedIds(res.orderedShopIds);
      setManualDirty(false);
    } catch (e) {
      if (token === optimizeSeq.current) {
        toast("error", errMessage(e, "Optimisation failed"));
      }
    } finally {
      if (token === optimizeSeq.current) setOptimizing(false);
    }
  }, [start, selectedIds, preview, orderedIds, toast]);

  const moveStop = useCallback((index: number, dir: -1 | 1) => {
    setOrderedIds((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setManualDirty(true);
  }, []);

  const removeStop = useCallback((id: string) => {
    optimizeSeq.current++;
    setOptimizing(false);
    setOrderedIds((prev) => {
      const next = prev.filter((x) => x !== id);
      if (next.length === 0) {
        setPreview(null);
        setManualDirty(false);
      } else {
        setManualDirty(true);
      }
      return next;
    });
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const save = useCallback(async () => {
    if (!start || !preview || orderedIds.length === 0) return;
    if (!name.trim()) {
      toast("error", "Route name is required");
      return;
    }
    setSaving(true);
    try {
      const created = await api<RouteDto>("/api/routes", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          start: { lat: start.lat, lng: start.lng, label: start.label },
          shopIds: orderedIds,
          manualOrder: manualDirty,
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
          notes: notes.trim() ? notes.trim() : undefined,
        }),
      });
      if (assignDriverId) {
        try {
          await api<RouteDto>(`/api/routes/${created.id}/assign`, {
            method: "POST",
            body: JSON.stringify({ driverId: assignDriverId }),
          });
          toast("success", "Route created and assigned — the driver has been notified");
        } catch (e) {
          toast(
            "error",
            errMessage(e, "Route was created, but assignment failed — assign it from the route page"),
          );
        }
      } else {
        toast("success", "Route created");
      }
      router.push(`/routes/${created.id}`);
    } catch (e) {
      toast("error", errMessage(e, "Failed to save the route"));
      setSaving(false);
    }
  }, [start, preview, orderedIds, name, manualDirty, scheduledFor, notes, assignDriverId, router, toast]);

  /* -------------------------------- Derived UI ------------------------------- */

  const sortedShops = useMemo(() => {
    return shops
      .map((s) => ({
        shop: s,
        distanceM: start
          ? haversineMeters(start, { lat: s.latitude, lng: s.longitude })
          : 0,
      }))
      .sort((a, b) => a.distanceM - b.distanceM);
  }, [shops, start]);

  const legByShop = useMemo(() => {
    const map = new Map<string, { legDistanceM: number; legDurationS: number }>();
    for (const leg of preview?.legs ?? []) {
      map.set(leg.shopId, { legDistanceM: leg.legDistanceM, legDurationS: leg.legDurationS });
    }
    return map;
  }, [preview]);

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    if (start) {
      list.push({
        id: "__start",
        lat: start.lat,
        lng: start.lng,
        label: "S",
        kind: "start",
        title: start.label ?? "Starting point",
      });
    }
    if (preview) {
      orderedIds.forEach((id, i) => {
        const shop = shopCache.current.get(id);
        if (shop) {
          list.push({
            id,
            lat: shop.latitude,
            lng: shop.longitude,
            label: String(i + 1),
            kind: "selected",
            title: shop.name,
          });
        }
      });
    } else if (start) {
      const listed = new Set<string>();
      for (const s of shops) {
        listed.add(s.id);
        list.push({
          id: s.id,
          lat: s.latitude,
          lng: s.longitude,
          label: "",
          kind: selectedSet.has(s.id) ? "selected" : "shop",
          title: s.name,
        });
      }
      // Selected shops filtered out of the current search still show on the map.
      for (const id of selectedIds) {
        if (listed.has(id)) continue;
        const shop = shopCache.current.get(id);
        if (shop) {
          list.push({
            id,
            lat: shop.latitude,
            lng: shop.longitude,
            label: "",
            kind: "selected",
            title: shop.name,
          });
        }
      }
    }
    return list;
  }, [start, preview, orderedIds, shops, selectedIds, selectedSet]);

  const fitKey = useMemo(
    () =>
      [
        start ? `${start.lat.toFixed(5)},${start.lng.toFixed(5)}` : "none",
        preview ? `opt-${orderedIds.length}` : `pick-${shops.length}`,
      ].join("|"),
    [start, preview, orderedIds.length, shops.length],
  );

  const step2Enabled = start !== null;
  const step3Enabled = step2Enabled && selectedIds.length > 0;
  const step4Enabled = preview !== null && orderedIds.length > 0;

  /* ---------------------------------- Render --------------------------------- */

  return (
    <div>
      <PageHeader
        title="Plan a route"
        description="Pick a starting point, choose shops, optimise the order, then save."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* Left: wizard steps */}
        <div className="space-y-4">
          {/* STEP 1 */}
          <StepSection step={1} title="Starting point" enabled done={start !== null}>
            {start ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-emerald-900">
                    {start.label ?? "Starting point"}
                  </p>
                  <p className="text-xs text-emerald-700">
                    {start.lat.toFixed(5)}, {start.lng.toFixed(5)}
                  </p>
                </div>
                <button
                  className="shrink-0 text-sm font-medium text-brand hover:underline"
                  onClick={() => {
                    setStart(null);
                    setPreview(null);
                    setOrderedIds([]);
                    setManualDirty(false);
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder='Address, "lat,lng" or Google Maps link'
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void resolveStart();
                    }}
                  />
                  <Button
                    variant="secondary"
                    loading={resolving}
                    disabled={!startInput.trim()}
                    onClick={() => void resolveStart()}
                  >
                    Resolve
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" loading={locating} onClick={useMyLocation}>
                    Use my location
                  </Button>
                  {lastStart && (
                    <button
                      className="max-w-full truncate rounded-full border border-brand/25 bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-strong hover:bg-brand-soft"
                      onClick={() => chooseStart(lastStart)}
                      title="Reuse the starting point from your previous route"
                    >
                      Use last: {lastStart.label ?? `${lastStart.lat.toFixed(4)}, ${lastStart.lng.toFixed(4)}`}
                    </button>
                  )}
                </div>
                {candidates && candidates.length > 0 && (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <p className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
                      Did you mean:
                    </p>
                    <ul className="divide-y divide-gray-50">
                      {candidates.map((c, i) => (
                        <li key={`${c.lat}-${c.lng}-${i}`}>
                          <button
                            className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-brand-soft"
                            onClick={() => chooseStart({ lat: c.lat, lng: c.lng, label: c.label })}
                          >
                            {c.label}
                            <span className="block text-xs text-gray-400">
                              {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </StepSection>

          {/* STEP 2 */}
          <StepSection
            step={2}
            title="Select shops"
            enabled={step2Enabled}
            done={selectedIds.length > 0}
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search shops…"
                  value={shopQuery}
                  onChange={(e) => setShopQuery(e.target.value)}
                />
                <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong">
                  {selectedIds.length} selected
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <button
                  className="font-medium text-brand hover:underline disabled:text-gray-300"
                  disabled={shops.length === 0}
                  onClick={selectAllShown}
                >
                  Select all shown ({shops.length})
                </button>
                <button
                  className="font-medium text-gray-500 hover:underline disabled:text-gray-300"
                  disabled={selectedIds.length === 0}
                  onClick={clearSelection}
                >
                  Clear
                </button>
              </div>
              {shopsLoading ? (
                <LoadingBlock label="Loading shops…" />
              ) : sortedShops.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">
                  No active shops match this search.
                </p>
              ) : (
                <ul className="max-h-72 divide-y divide-gray-50 overflow-y-auto rounded-lg border border-gray-200">
                  {sortedShops.map(({ shop, distanceM }) => (
                    <li key={shop.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 accent-brand"
                          checked={selectedSet.has(shop.id)}
                          onChange={() => toggleShop(shop.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-900">
                            {shop.name}
                          </span>
                          {shop.address && (
                            <span className="block truncate text-xs text-gray-500">
                              {shop.address}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-gray-400">
                          {formatDistance(distanceM)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </StepSection>

          {/* STEP 3 */}
          <StepSection
            step={3}
            title="Optimize"
            enabled={step3Enabled}
            done={preview !== null}
          >
            <div className="space-y-3">
              {!preview && (
                <Button
                  loading={optimizing}
                  disabled={!step3Enabled}
                  onClick={() => void optimize()}
                >
                  {optimizing ? "Optimizing…" : "Optimize route"}
                </Button>
              )}

              {preview && (
                <>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-800">
                    <span className="font-semibold">{formatDistance(preview.totalDistanceM)}</span>
                    <span className="text-gray-400">·</span>
                    <span className="font-semibold">{formatDuration(preview.totalDurationS)}</span>
                    <Badge
                      value={preview.distanceSource === "OSRM" ? "Road network" : "Estimated"}
                    />
                  </div>

                  {manualDirty && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Order changed — totals update on save or re-optimize.
                    </p>
                  )}

                  <ol className="divide-y divide-gray-50 rounded-lg border border-gray-200">
                    {orderedIds.map((id, i) => {
                      const shop = shopCache.current.get(id);
                      const leg = manualDirty ? undefined : legByShop.get(id);
                      return (
                        <li key={id} className="flex items-center gap-2.5 px-3 py-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-gray-900">
                              {shop?.name ?? id}
                            </span>
                            <span className="block text-xs text-gray-400">
                              {leg ? `+${formatDistance(leg.legDistanceM)}` : "—"}
                            </span>
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
                              disabled={i === orderedIds.length - 1}
                              onClick={() => moveStop(i, 1)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M12 5v14M19 12l-7 7-7-7" />
                              </svg>
                            </button>
                            <button
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                              aria-label="Remove stop"
                              onClick={() => removeStop(id)}
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

                  <Button
                    variant="secondary"
                    loading={optimizing}
                    onClick={() => void optimize()}
                  >
                    Re-optimize
                  </Button>
                </>
              )}
            </div>
          </StepSection>

          {/* STEP 4 */}
          <StepSection step={4} title="Save & assign" enabled={step4Enabled}>
            <div className="space-y-3">
              <Field label="Route name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Scheduled for">
                <Input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes for the driver…"
                />
              </Field>
              <Field label="Assign to driver (optional)">
                <Select
                  value={assignDriverId}
                  onChange={(e) => setAssignDriverId(e.target.value)}
                >
                  <option value="">Assign later</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                loading={saving}
                disabled={!step4Enabled || !name.trim()}
                onClick={() => void save()}
                className="w-full"
              >
                {assignDriverId ? "Save & assign route" : "Save route"}
              </Button>
              <p className="text-xs text-gray-400">
                {assignDriverId
                  ? "The driver is notified by email with the route link."
                  : "You can also assign a driver from the route page after saving."}
              </p>
            </div>
          </StepSection>
        </div>

        {/* Right: sticky map */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <MapView
            markers={markers}
            polyline={preview && !manualDirty ? preview.geometry : null}
            height="70vh"
            fitKey={fitKey}
            onMarkerClick={(id) => {
              if (id === "__start" || preview) return;
              toggleShop(id);
            }}
          />
          {optimizing && (
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
              <Spinner size={14} /> Optimizing…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
