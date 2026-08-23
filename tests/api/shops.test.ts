import { beforeAll, describe, expect, it } from "vitest";
import { admin, type TestClient } from "./http";

let c: TestClient;

beforeAll(async () => {
  c = await admin();
});

describe("shop listing", () => {
  it("lists seeded shops with pagination metadata", async () => {
    const r = await c.get("/api/shops?pageSize=2&page=1");
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.total).toBeGreaterThanOrEqual(5);
    expect(r.body.page).toBe(1);
  });

  it("searches by name", async () => {
    const r = await c.get("/api/shops?q=Alpha");
    expect(r.status).toBe(200);
    expect(r.body.items.some((s: { name: string }) => s.name === "Alpha Store")).toBe(true);
    expect(r.body.items.every((s: { name: string }) => /alpha/i.test(s.name))).toBe(true);
  });

  it("rejects invalid query values", async () => {
    const r = await c.get("/api/shops?page=0");
    expect(r.status).toBe(400);
  });
});

describe("shop CRUD", () => {
  let createdId: string;

  it("creates a shop", async () => {
    const r = await c.post("/api/shops", {
      name: "Zeta Fresh",
      address: "9 Ring Rd",
      latitude: 23.1001,
      longitude: 72.49,
      phone: "+91 90000 11111",
    });
    expect(r.status).toBe(201);
    expect(r.body.id).toBeTruthy();
    createdId = r.body.id;
  });

  it("rejects invalid coordinates", async () => {
    const r = await c.post("/api/shops", { name: "Bad", latitude: 123, longitude: 72 });
    expect(r.status).toBe(400);
  });

  it("detects duplicates and honours force", async () => {
    const dup = await c.post("/api/shops", {
      name: "Zeta Fresh",
      latitude: 23.10012,
      longitude: 72.49001,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");

    const forced = await c.post("/api/shops", {
      name: "Zeta Fresh",
      latitude: 23.10012,
      longitude: 72.49001,
      force: true,
    });
    expect(forced.status).toBe(201);
    await c.delete(`/api/shops/${forced.body.id}`);
  });

  it("updates a shop", async () => {
    const r = await c.patch(`/api/shops/${createdId}`, { notes: "Updated note", status: "INACTIVE" });
    expect(r.status).toBe(200);
    expect(r.body.notes).toBe("Updated note");
    expect(r.body.status).toBe("INACTIVE");
  });

  it("filters by status", async () => {
    const inactive = await c.get("/api/shops?status=INACTIVE");
    expect(inactive.body.items.some((s: { id: string }) => s.id === createdId)).toBe(true);
    const active = await c.get("/api/shops?status=ACTIVE");
    expect(active.body.items.some((s: { id: string }) => s.id === createdId)).toBe(false);
  });

  it("soft deletes a shop", async () => {
    const del = await c.delete(`/api/shops/${createdId}`);
    expect(del.status).toBe(200);
    const all = await c.get("/api/shops?status=ALL&pageSize=500");
    expect(all.body.items.some((s: { id: string }) => s.id === createdId)).toBe(false);
    const byId = await c.get(`/api/shops/${createdId}`);
    expect(byId.status).toBe(404);
  });

  it("404s on a missing shop", async () => {
    const r = await c.get("/api/shops/nonexistent-id");
    expect(r.status).toBe(404);
  });
});

describe("CSV import", () => {
  function csvUpload(content: string, filename = "upload.csv"): FormData {
    const fd = new FormData();
    fd.append("file", new File([content], filename, { type: "text/csv" }));
    return fd;
  }

  it("imports valid rows, skips duplicates and invalid rows, and reports a summary", async () => {
    const csv = `Party,Latitude,Longitude,Bill No
Import One,23.111,72.481,IMP1
Alpha Store,23.0634,72.5120,
Broken Row,999,72.48,
Import Two,23.112,72.482,IMP2`;
    const r = await c.post("/api/shops/import", csvUpload(csv));
    expect([200, 201]).toContain(r.status);
    expect(r.body.imported).toBe(2);
    expect(r.body.skippedDuplicates).toBe(1); // Alpha Store already in DB
    expect(r.body.invalid).toBe(1);
    expect(r.body.errors.length).toBeGreaterThanOrEqual(1);

    const list = await c.get("/api/shops?q=Import%20One");
    expect(list.body.items).toHaveLength(1);
  });

  it("re-importing the same file skips everything as duplicates", async () => {
    const csv = `Party,Latitude,Longitude,Bill No
Import One,23.111,72.481,IMP1`;
    const r = await c.post("/api/shops/import", csvUpload(csv));
    expect([200, 201]).toContain(r.status);
    expect(r.body.imported).toBe(0);
    expect(r.body.skippedDuplicates).toBe(1);
  });

  it("recovers coordinates from Google Maps links", async () => {
    const csv = `Party,Latitude,Longitude,Google Maps Link
Link Import,,,"https://www.google.com/maps/dir/?api=1&destination=23.1177,72.4855&travelmode=driving"`;
    const r = await c.post("/api/shops/import", csvUpload(csv));
    expect(r.body.imported).toBe(1);
  });

  it("rejects a request without a file", async () => {
    const r = await c.post("/api/shops/import", new FormData());
    expect(r.status).toBe(400);
  });

  it("handles a garbage file gracefully", async () => {
    const r = await c.post("/api/shops/import", csvUpload("this is not,really\ncsv data at all"));
    expect([200, 201]).toContain(r.status);
    expect(r.body.imported).toBe(0);
  });

  it("records import history", async () => {
    const r = await c.get("/api/imports");
    expect([200, 201]).toContain(r.status);
    expect(r.body.length ?? r.body.items?.length).toBeGreaterThanOrEqual(1);
  });
});
