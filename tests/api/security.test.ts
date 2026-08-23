import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, driver, type TestClient } from "./http";

let d: TestClient;
let a: TestClient;

beforeAll(async () => {
  d = await driver();
  a = await admin();
});

describe("unauthenticated access", () => {
  const protectedEndpoints = [
    ["GET", "/api/shops"],
    ["GET", "/api/routes"],
    ["GET", "/api/drivers"],
    ["GET", "/api/dashboard/stats"],
    ["GET", "/api/audit"],
    ["POST", "/api/optimize/preview"],
  ] as const;

  it("returns 401 for every protected endpoint", async () => {
    for (const [method, path] of protectedEndpoints) {
      const r = await anon().request(method, path, method === "POST" ? {} : undefined);
      expect(r.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("driver role restrictions (RBAC)", () => {
  it("blocks drivers from admin-only endpoints", async () => {
    const cases: [string, string, unknown?][] = [
      ["GET", "/api/shops"],
      ["POST", "/api/shops", { name: "X", latitude: 23, longitude: 72 }],
      ["POST", "/api/shops/import"],
      ["GET", "/api/drivers"],
      ["POST", "/api/drivers", { name: "X", email: "x@test.local" }],
      ["GET", "/api/dashboard/stats"],
      ["GET", "/api/audit"],
      ["GET", "/api/imports"],
      ["POST", "/api/optimize/preview", { start: { lat: 23, lng: 72 }, shopIds: ["a"] }],
      ["POST", "/api/routes", { name: "X", start: { lat: 23, lng: 72 }, shopIds: ["a"] }],
    ];
    for (const [method, path, body] of cases) {
      const r = await d.request(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  it("blocks drivers from assigning routes or managing other routes", async () => {
    const shops = await a.get("/api/shops?pageSize=3");
    const created = await a.post("/api/routes", {
      name: "RBAC Route",
      start: { lat: 23.05, lng: 72.51 },
      shopIds: shops.body.items.slice(0, 2).map((s: { id: string }) => s.id),
    });
    const routeId = created.body.id;

    const assign = await d.post(`/api/routes/${routeId}/assign`, { driverId: "whatever" });
    expect([403, 404]).toContain(assign.status);

    const patch = await d.patch(`/api/routes/${routeId}`, { name: "Hacked" });
    expect([403, 404]).toContain(patch.status);

    const del = await d.delete(`/api/routes/${routeId}`);
    expect([403, 404]).toContain(del.status);

    // Unassigned driver cannot even see it.
    const view = await d.get(`/api/routes/${routeId}`);
    expect(view.status).toBe(404);

    await a.delete(`/api/routes/${routeId}`);
  });

  it("hides draft routes from route lists for drivers", async () => {
    const list = await d.get("/api/routes?status=ALL");
    expect(list.status).toBe(200);
    expect(list.body.items.every((r: { status: string }) => r.status !== "DRAFT")).toBe(true);
  });
});

describe("input validation", () => {
  it("rejects malformed bodies with 400s", async () => {
    const cases: [string, string, unknown][] = [
      ["POST", "/api/shops", { name: "" }],
      ["POST", "/api/shops", { name: "A", latitude: "abc", longitude: 72 }],
      ["POST", "/api/routes", { name: "A", start: { lat: 23, lng: 72 }, shopIds: [] }],
      ["POST", "/api/drivers", { name: "A", email: "not-email" }],
    ];
    for (const [method, path, body] of cases) {
      const r = await a.request(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(400);
    }
  });

  it("does not leak stack traces on errors", async () => {
    const r = await a.get("/api/shops/definitely-missing-id");
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts|prisma|stack/i);
  });
});

describe("security headers", () => {
  it("sets hardening headers", async () => {
    const r = await anon().get("/api/health");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("audit logging", () => {
  it("records admin actions with actor attribution", async () => {
    await a.post("/api/shops", {
      name: "Audit Probe",
      latitude: 23.2,
      longitude: 72.6,
      force: true,
    });
    const r = await a.get("/api/audit");
    expect(r.status).toBe(200);
    const items = r.body.items ?? r.body;
    expect(items.some((l: { action: string }) => l.action === "shop.create")).toBe(true);
    expect(items.some((l: { action: string }) => l.action === "auth.login")).toBe(true);
  });
});
