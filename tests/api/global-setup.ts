import { spawn, execSync, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

/**
 * Boots the real Next.js server against an ISOLATED Postgres schema on the
 * configured database, so tests never touch the app's real data. External
 * services (OSRM/Nominatim) point at an unreachable port so the fallback
 * paths run deterministically, and email is forced to log-only.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 3100;
const TEST_SCHEMA = "qa_test";
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Build a connection string that targets the isolated test schema. */
function withSchema(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  // A direct (non-pooled) connection keeps DDL and prepared statements simple.
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

const DIRECT = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DIRECT) throw new Error("DIRECT_URL or DATABASE_URL must be set to run API tests");
const TEST_URL = withSchema(DIRECT, TEST_SCHEMA);

const TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: TEST_URL,
  DIRECT_URL: TEST_URL,
  AUTH_SECRET: "test-secret-0123456789abcdef-0123456789abcdef",
  APP_BASE_URL: BASE_URL,
  OSRM_BASE_URL: "http://127.0.0.1:9",
  NOMINATIM_BASE_URL: "http://127.0.0.1:9",
  SMTP_HOST: "",
  RESEND_API_KEY: "", // force log-only email in tests
  SEED_ADMIN_EMAIL: "admin@test.local",
  SEED_ADMIN_PASSWORD: "AdminTest@123",
  NEXT_TELEMETRY_DISABLED: "1",
};
delete (TEST_ENV as Record<string, string | undefined>).NODE_ENV;

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

async function dropTestSchema(): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: TEST_URL });
  try {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
  } finally {
    await prisma.$disconnect();
  }
}

export async function setup(): Promise<void> {
  // Fresh, isolated schema every run.
  await dropTestSchema();
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: ROOT,
    env: TEST_ENV,
    stdio: "pipe",
  });
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
  await dropTestSchema();
}
