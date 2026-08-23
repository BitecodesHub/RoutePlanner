import { spawn, execSync, type ChildProcess } from "child_process";
import { rmSync } from "fs";
import { join } from "path";

/**
 * Boots the real Next.js server against a scratch SQLite database.
 * External services (OSRM/Nominatim) point at an unreachable port so the
 * fallback paths run deterministically without network access.
 */

const ROOT = join(__dirname, "../..");
const PORT = 3100;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

const TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: "file:./test.db",
  AUTH_SECRET: "test-secret-0123456789abcdef-0123456789abcdef",
  APP_BASE_URL: BASE_URL,
  OSRM_BASE_URL: "http://127.0.0.1:9",
  NOMINATIM_BASE_URL: "http://127.0.0.1:9",
  SMTP_HOST: "",
  SEED_ADMIN_EMAIL: "admin@test.local",
  SEED_ADMIN_PASSWORD: "AdminTest@123",
  NEXT_TELEMETRY_DISABLED: "1",
};
delete (TEST_ENV as Record<string, string | undefined>).NODE_ENV; // let next dev choose its own mode

let server: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`Server did not become healthy at ${url}: ${lastErr}`);
}

export async function setup(): Promise<void> {
  rmSync(join(ROOT, "prisma/test.db"), { force: true });
  rmSync(join(ROOT, "prisma/test.db-journal"), { force: true });

  execSync("npx prisma migrate deploy", { cwd: ROOT, env: TEST_ENV, stdio: "pipe" });
  execSync("npx tsx tests/api/seed-test.ts", { cwd: ROOT, env: TEST_ENV, stdio: "pipe" });

  server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: TEST_ENV,
    stdio: "pipe",
    detached: true,
  });
  server.stderr?.on("data", (d: Buffer) => {
    const line = d.toString();
    if (/error/i.test(line)) console.error("[next]", line.trim());
  });

  await waitForServer(`${BASE_URL}/api/health`, 90_000);
}

export async function teardown(): Promise<void> {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  rmSync(join(ROOT, "prisma/test.db"), { force: true });
  rmSync(join(ROOT, "prisma/test.db-journal"), { force: true });
}
