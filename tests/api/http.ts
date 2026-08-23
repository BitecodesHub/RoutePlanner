/** Tiny HTTP client with a cookie jar for API tests. */

export const BASE_URL = "http://127.0.0.1:3100";

export class TestClient {
  private cookie = "";

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const isForm = body instanceof FormData;
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body && !isForm ? { "content-type": "application/json" } : {}),
      },
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const session = setCookie.split(",").find((c) => c.trim().startsWith("session="));
      if (session) this.cookie = session.split(";")[0].trim();
    }
    let parsed: any = null;
    try {
      parsed = await res.json();
    } catch {
      /* empty body */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get(path: string) {
    return this.request("GET", path);
  }
  post(path: string, body?: unknown) {
    return this.request("POST", path, body);
  }
  patch(path: string, body?: unknown) {
    return this.request("PATCH", path, body);
  }
  delete(path: string) {
    return this.request("DELETE", path);
  }

  async loginAsAdmin() {
    const r = await this.post("/api/auth/login", {
      email: "admin@test.local",
      password: "AdminTest@123",
    });
    if (r.status !== 200) throw new Error(`admin login failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async loginAsDriver(email = "driver1@test.local", password = "DriverTest@123") {
    const r = await this.post("/api/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`driver login failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export function anon(): TestClient {
  return new TestClient();
}

export async function admin(): Promise<TestClient> {
  const c = new TestClient();
  await c.loginAsAdmin();
  return c;
}

export async function driver(): Promise<TestClient> {
  const c = new TestClient();
  await c.loginAsDriver();
  return c;
}
