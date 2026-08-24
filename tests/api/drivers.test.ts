import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, type TestClient } from "./http";

let c: TestClient;

beforeAll(async () => {
  c = await admin();
});

describe("driver lifecycle", () => {
  let driverId: string;
  let tempPassword: string;

  it("creates a driver with an auto-generated temporary password", async () => {
    const r = await c.post("/api/drivers", {
      name: "Lifecycle Driver",
      email: "lifecycle@test.local",
      phone: "+91 98888 00000",
    });
    expect(r.status).toBe(201);
    expect(r.body.driver ?? r.body).toBeTruthy();
    const driver = r.body.driver ?? r.body;
    driverId = driver.id;
    tempPassword = r.body.tempPassword;
    expect(tempPassword).toBeTruthy();
  });

  it("rejects a duplicate email", async () => {
    const r = await c.post("/api/drivers", {
      name: "Duplicate",
      email: "lifecycle@test.local",
    });
    expect(r.status).toBe(409);
  });

  it("lets the driver log in with the temporary password and forces a change", async () => {
    const d = anon();
    const login = await d.post("/api/auth/login", {
      email: "lifecycle@test.local",
      password: tempPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);

    const change = await d.post("/api/auth/change-password", {
      currentPassword: tempPassword,
      newPassword: "Lifecycle@123",
    });
    expect(change.status).toBe(200);
    const me = await d.get("/api/auth/me");
    expect(me.body.mustChangePassword).toBe(false);
  });

  it("lists drivers with route counts", async () => {
    const r = await c.get("/api/drivers");
    expect(r.status).toBe(200);
    const items = r.body.items ?? r.body;
    const found = items.find((d: { id: string }) => d.id === driverId);
    expect(found).toBeTruthy();
    expect(found.activeRouteCount).toBe(0);
  });

  it("updates driver details", async () => {
    const r = await c.patch(`/api/drivers/${driverId}`, { phone: "+91 97777 00000" });
    expect(r.status).toBe(200);
    expect(r.body.phone).toBe("+91 97777 00000");
  });

  it("deactivation blocks login", async () => {
    await c.patch(`/api/drivers/${driverId}`, { status: "INACTIVE" });
    const login = await anon().post("/api/auth/login", {
      email: "lifecycle@test.local",
      password: "Lifecycle@123",
    });
    expect(login.status).toBe(401);
    await c.patch(`/api/drivers/${driverId}`, { status: "ACTIVE" });
  });

  it("resets credentials: old password dies, new temp password works", async () => {
    const r = await c.post(`/api/drivers/${driverId}/reset-credentials`);
    expect(r.status).toBe(200);
    const newTemp = r.body.tempPassword;
    expect(newTemp).toBeTruthy();

    const oldLogin = await anon().post("/api/auth/login", {
      email: "lifecycle@test.local",
      password: "Lifecycle@123",
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await anon().post("/api/auth/login", {
      email: "lifecycle@test.local",
      password: newTemp,
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.mustChangePassword).toBe(true);
  });

  it("soft deletes the driver", async () => {
    const del = await c.delete(`/api/drivers/${driverId}`);
    expect(del.status).toBe(200);
    const list = await c.get("/api/drivers");
    const items = list.body.items ?? list.body;
    expect(items.some((d: { id: string }) => d.id === driverId)).toBe(false);
  });

  it("frees the email address after deletion so the driver can be re-created", async () => {
    const r = await c.post("/api/drivers", {
      name: "Lifecycle Reborn",
      email: "lifecycle@test.local",
      password: "Reborn@12345",
    });
    expect(r.status).toBe(201);
    const login = await anon().post("/api/auth/login", {
      email: "lifecycle@test.local",
      password: "Reborn@12345",
    });
    expect(login.status).toBe(200);
  });

  it("accepts an explicit password on creation", async () => {
    const r = await c.post("/api/drivers", {
      name: "Explicit Password",
      email: "explicit@test.local",
      password: "Explicit@123",
    });
    expect(r.status).toBe(201);
    const login = await anon().post("/api/auth/login", {
      email: "explicit@test.local",
      password: "Explicit@123",
    });
    expect(login.status).toBe(200);
  });

  it("validates the create payload", async () => {
    const r = await c.post("/api/drivers", { name: "", email: "bad" });
    expect(r.status).toBe(400);
  });
});
