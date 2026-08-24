import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, type TestClient } from "./http";

const START = { lat: 23.0499, lng: 72.5154, label: "Godown" };

let c: TestClient;
let shopIds: string[] = [];

beforeAll(async () => {
  c = await admin();
  const shops = await c.get("/api/shops?pageSize=200&status=ACTIVE");
  shopIds = shops.body.items
    .filter((s: { externalRef: string | null }) => s.externalRef?.startsWith("T"))
    .map((s: { id: string }) => s.id);
  if (shopIds.length < 4) throw new Error("fixture shops missing");
});

describe("optimize preview", () => {
  it("returns an optimised order with totals (fallback matrix)", async () => {
    const r = await c.post("/api/optimize/preview", {
      start: START,
      shopIds: shopIds.slice(0, 4),
    });
    expect(r.status).toBe(200);
    expect(r.body.orderedShopIds).toHaveLength(4);
    expect(new Set(r.body.orderedShopIds).size).toBe(4);
    expect(r.body.totalDistanceM).toBeGreaterThan(0);
    expect(r.body.totalDurationS).toBeGreaterThan(0);
    expect(r.body.distanceSource).toBe("HAVERSINE"); // OSRM is unreachable in tests
    expect(Array.isArray(r.body.geometry)).toBe(true);
    expect(r.body.legs).toHaveLength(4);
  });

  it("rejects unknown shop ids", async () => {
    const r = await c.post("/api/optimize/preview", {
      start: START,
      shopIds: ["missing-shop-id"],
    });
    expect(r.status).toBe(400);
  });

  it("rejects an invalid starting point", async () => {
    const r = await c.post("/api/optimize/preview", {
      start: { lat: 123, lng: 72 },
      shopIds: shopIds.slice(0, 2),
    });
    expect(r.status).toBe(400);
  });
});

describe("route lifecycle", () => {
  let routeId: string;
  let shareToken: string;
  let driverId: string;

  it("creates an optimised round-trip route", async () => {
    const r = await c.post("/api/routes", {
      name: "Lifecycle Route",
      start: START,
      shopIds: shopIds.slice(0, 4),
    });
    expect(r.status).toBe(201);
    routeId = r.body.id;
    shareToken = r.body.shareToken;
    expect(r.body.status).toBe("DRAFT");
    expect(r.body.stops).toHaveLength(4);
    expect(r.body.stops.map((s: { sequence: number }) => s.sequence)).toEqual([1, 2, 3, 4]);
    expect(r.body.totalDistanceM).toBeGreaterThan(0);
    expect(shareToken.length).toBeGreaterThanOrEqual(20);
    expect(r.body.startLat).toBeCloseTo(START.lat);
  });

  it("respects manual stop order", async () => {
    const manual = [...shopIds.slice(0, 3)].reverse();
    const r = await c.post("/api/routes", {
      name: "Manual Route",
      start: START,
      shopIds: manual,
      manualOrder: true,
    });
    expect(r.status).toBe(201);
    expect(r.body.stops.map((s: { shop: { id: string } }) => s.shop.id)).toEqual(manual);
    await c.delete(`/api/routes/${r.body.id}`);
  });

  it("lists routes", async () => {
    const r = await c.get("/api/routes");
    expect(r.status).toBe(200);
    expect(r.body.items.some((x: { id: string }) => x.id === routeId)).toBe(true);
    const item = r.body.items.find((x: { id: string }) => x.id === routeId);
    expect(item.stopCount).toBe(4);
  });

  it("reorders stops via PATCH", async () => {
    const detail = await c.get(`/api/routes/${routeId}`);
    const currentOrder = detail.body.stops.map((s: { shop: { id: string } }) => s.shop.id);
    const newOrder = [...currentOrder].reverse();
    const r = await c.patch(`/api/routes/${routeId}`, { shopIds: newOrder });
    expect(r.status).toBe(200);
    expect(r.body.stops.map((s: { shop: { id: string } }) => s.shop.id)).toEqual(newOrder);
  });

  it("re-optimises on demand", async () => {
    const r = await c.patch(`/api/routes/${routeId}`, { reoptimize: true });
    expect(r.status).toBe(200);
    expect(r.body.stops).toHaveLength(4);
  });

  it("assigns a driver and moves to ASSIGNED", async () => {
    const created = await c.post("/api/drivers", {
      name: "Route Driver",
      email: "routedriver@test.local",
      password: "RouteDriver@1",
    });
    driverId = (created.body.driver ?? created.body).id;

    const r = await c.post(`/api/routes/${routeId}/assign`, { driverId });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ASSIGNED");
    expect(r.body.driver.id).toBe(driverId);
    expect(r.body.assignedAt).toBeTruthy();
  });

  it("shows the route to the assigned driver only", async () => {
    const d = anon();
    await d.loginAsDriver("routedriver@test.local", "RouteDriver@1");
    const list = await d.get("/api/routes");
    expect(list.body.items.some((x: { id: string }) => x.id === routeId)).toBe(true);
    const detail = await d.get(`/api/routes/${routeId}`);
    expect(detail.status).toBe(200);

    const stranger = anon();
    await stranger.loginAsDriver(); // driver1 has no assignment
    const denied = await stranger.get(`/api/routes/${routeId}`);
    expect(denied.status).toBe(404);
  });

  it("walks the driver execution flow: start, stop updates, complete", async () => {
    const d = anon();
    await d.loginAsDriver("routedriver@test.local", "RouteDriver@1");

    const premature = await d.patch(
      `/api/routes/${routeId}/stops/placeholder`,
      { status: "COMPLETED" },
    );
    expect([404, 409]).toContain(premature.status);

    const start = await d.post(`/api/routes/${routeId}/status`, { status: "IN_PROGRESS" });
    expect(start.status).toBe(200);
    expect(start.body.startedAt).toBeTruthy();

    const detail = await d.get(`/api/routes/${routeId}`);
    const stops = detail.body.stops;

    const arrive = await d.patch(`/api/routes/${routeId}/stops/${stops[0].id}`, {
      status: "ARRIVED",
    });
    expect(arrive.status).toBe(200);

    for (const stop of stops.slice(0, 3)) {
      const done = await d.patch(`/api/routes/${routeId}/stops/${stop.id}`, {
        status: "COMPLETED",
      });
      expect(done.status).toBe(200);
    }
    const skip = await d.patch(`/api/routes/${routeId}/stops/${stops[3].id}`, {
      status: "SKIPPED",
      notes: "Closed on arrival",
    });
    expect(skip.status).toBe(200);

    const after = await d.get(`/api/routes/${routeId}`);
    expect(after.body.stops.filter((s: { status: string }) => s.status === "COMPLETED")).toHaveLength(3);
    expect(after.body.stops[3].status === "SKIPPED" || after.body.stops.some((s: {status:string}) => s.status === "SKIPPED")).toBe(true);

    const complete = await d.post(`/api/routes/${routeId}/status`, { status: "COMPLETED" });
    expect(complete.status).toBe(200);
    expect(complete.body.completedAt).toBeTruthy();
  });

  it("blocks edits on a completed route", async () => {
    const r = await c.patch(`/api/routes/${routeId}`, { reoptimize: true });
    expect(r.status).toBe(409);
  });

  it("blocks illegal driver transitions", async () => {
    const d = anon();
    await d.loginAsDriver("routedriver@test.local", "RouteDriver@1");
    const r = await d.post(`/api/routes/${routeId}/status`, { status: "IN_PROGRESS" });
    expect(r.status).toBe(409);
  });

  it("serves the public share link without auth and with redacted data", async () => {
    const r = await anon().get(`/api/share/${shareToken}`);
    expect(r.status).toBe(200);
    expect(r.body.stops).toHaveLength(4);
    if (r.body.driver) {
      expect(r.body.driver.email ?? "").toBe("");
      expect(r.body.driver.phone ?? null).toBeNull();
    }
    for (const stop of r.body.stops) {
      // Full CRM redaction: only navigation data survives.
      expect(stop.shop.email ?? null).toBeNull();
      expect(stop.shop.notes ?? null).toBeNull();
      expect(stop.shop.phone ?? null).toBeNull();
      expect(stop.shop.contactName ?? null).toBeNull();
      expect(stop.shop.externalRef ?? null).toBeNull();
      expect(stop.shop.name).toBeTruthy();
      expect(typeof stop.shop.latitude).toBe("number");
    }
  });

  it("404s on an invalid share token", async () => {
    const r = await anon().get("/api/share/not-a-real-token-aaaaaaaaaaaaaaa");
    expect(r.status).toBe(404);
  });

  it("cancel and reopen transitions work for admins, and reopen resets state", async () => {
    const r2 = await c.post("/api/routes", {
      name: "Cancel Me",
      start: START,
      shopIds: shopIds.slice(0, 2),
    });
    const id = r2.body.id;
    await c.post(`/api/routes/${id}/assign`, { driverId });
    const cancel = await c.post(`/api/routes/${id}/status`, { status: "CANCELLED" });
    expect(cancel.status).toBe(200);
    const reopen = await c.post(`/api/routes/${id}/status`, { status: "DRAFT" });
    expect(reopen.status).toBe(200);
    // A reopened route is a clean draft: no stale driver or timestamps.
    expect(reopen.body.driver).toBeNull();
    expect(reopen.body.assignedAt).toBeNull();
    expect(reopen.body.startedAt).toBeNull();
    expect(reopen.body.stops.every((s: { status: string }) => s.status === "PENDING")).toBe(true);
    await c.delete(`/api/routes/${id}`);
  });

  it("soft deletes a route and kills its share link", async () => {
    const del = await c.delete(`/api/routes/${routeId}`);
    expect(del.status).toBe(200);
    const shared = await anon().get(`/api/share/${shareToken}`);
    expect(shared.status).toBe(404);
    const detail = await c.get(`/api/routes/${routeId}`);
    expect(detail.status).toBe(404);
  });
});

describe("dashboard stats", () => {
  it("returns aggregate numbers", async () => {
    const r = await c.get("/api/dashboard/stats");
    expect(r.status).toBe(200);
    expect(r.body.totalShops).toBeGreaterThan(0);
    expect(typeof r.body.activeDrivers).toBe("number");
    expect(Array.isArray(r.body.recentRoutes)).toBe(true);
    expect(Array.isArray(r.body.recentActivity)).toBe(true);
  });
});
