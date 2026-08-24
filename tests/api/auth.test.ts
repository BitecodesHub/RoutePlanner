import { describe, expect, it } from "vitest";
import { anon, admin, TestClient } from "./http";

describe("health", () => {
  it("is public and reports db connectivity", async () => {
    const r = await anon().get("/api/health");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
    expect(r.body.db).toBe(true);
  });
});

describe("login", () => {
  it("rejects a wrong password with a generic message", async () => {
    const r = await anon().post("/api/auth/login", {
      email: "admin@test.local",
      password: "definitely-wrong",
    });
    expect(r.status).toBe(401);
    expect(r.body.error.message).not.toMatch(/password specifically|user not found/i);
  });

  it("rejects an unknown email identically", async () => {
    const r = await anon().post("/api/auth/login", {
      email: "ghost@test.local",
      password: "whatever123",
    });
    expect(r.status).toBe(401);
  });

  it("validates the payload", async () => {
    const r = await anon().post("/api/auth/login", { email: "not-an-email", password: "" });
    expect(r.status).toBe(400);
  });

  it("treats emails case-insensitively", async () => {
    const r = await anon().post("/api/auth/login", {
      email: "ADMIN@Test.Local",
      password: "AdminTest@123",
    });
    expect(r.status).toBe(200);
    expect(r.body.email).toBe("admin@test.local");
  });

  it("succeeds with correct credentials and sets a session cookie", async () => {
    const c = anon();
    const r = await c.post("/api/auth/login", {
      email: "admin@test.local",
      password: "AdminTest@123",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ email: "admin@test.local", role: "ADMIN" });
    const me = await c.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("admin@test.local");
  });

  it("rate limits repeated failures per account", async () => {
    const c = anon();
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const r = await c.post("/api/auth/login", {
        email: "ratelimit-victim@test.local",
        password: "wrong-pass-123",
      });
      lastStatus = r.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("logout", () => {
  it("invalidates the session", async () => {
    const c = await admin();
    await c.post("/api/auth/logout");
    const me = await c.get("/api/auth/me");
    expect(me.status).toBe(401);
  });
});

describe("change password", () => {
  it("rejects a wrong current password", async () => {
    const c = await admin();
    const r = await c.post("/api/auth/change-password", {
      currentPassword: "nope-nope-1",
      newPassword: "NewPass@12345",
    });
    expect([400, 401, 403]).toContain(r.status);
  });

  it("changes the password, keeps the session alive, and invalidates the old password", async () => {
    const c = await admin();
    const r = await c.post("/api/auth/change-password", {
      currentPassword: "AdminTest@123",
      newPassword: "Rotated@12345",
    });
    expect(r.status).toBe(200);

    // Session survives the token-version bump (fresh cookie issued).
    const me = await c.get("/api/auth/me");
    expect(me.status).toBe(200);

    const oldLogin = await anon().post("/api/auth/login", {
      email: "admin@test.local",
      password: "AdminTest@123",
    });
    expect(oldLogin.status).toBe(401);

    // Rotate back for the remaining test files.
    const back = await c.post("/api/auth/change-password", {
      currentPassword: "Rotated@12345",
      newPassword: "AdminTest@123",
    });
    expect(back.status).toBe(200);
  });

  it("enforces a minimum length", async () => {
    const c = await admin();
    const r = await c.post("/api/auth/change-password", {
      currentPassword: "AdminTest@123",
      newPassword: "short",
    });
    expect(r.status).toBe(400);
  });
});

describe("password reset", () => {
  it("does not reveal whether an account exists", async () => {
    const r1 = await anon().post("/api/auth/forgot-password", { email: "admin@test.local" });
    const r2 = await anon().post("/api/auth/forgot-password", { email: "nobody@test.local" });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(JSON.stringify(r1.body)).toBe(JSON.stringify(r2.body));
  });

  it("rejects an invalid reset token", async () => {
    const r = await anon().post("/api/auth/reset-password", {
      token: "totally-invalid-token-value",
      newPassword: "Whatever@123",
    });
    expect(r.status).toBe(400);
  });
});

describe("session integrity", () => {
  it("rejects a tampered session cookie", async () => {
    const c = new TestClient();
    await c.loginAsAdmin();
    // Corrupt the cookie by flipping characters.
    (c as unknown as { cookie: string })["cookie"] = "session=eyJhbGciOiJIUzI1NiJ9.tampered.sig";
    const me = await c.get("/api/auth/me");
    expect(me.status).toBe(401);
  });
});
