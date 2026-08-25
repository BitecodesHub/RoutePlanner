import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Retry transient connection failures. Serverless Postgres (e.g. Neon) auto-
 * suspends its compute when idle; the first query after a cold start can fail
 * with P1001 (can't reach database) / P1017 (connection closed) before the
 * compute wakes. Retrying with a short backoff turns that into a slightly slow
 * request instead of a 500.
 */
const TRANSIENT_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);
const MAX_RETRIES = 3;

function isTransient(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_CODES.has(err.code);
  }
  return false;
}

function createClient(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        let lastError: unknown;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            lastError = err;
            if (!isTransient(err) || attempt === MAX_RETRIES) throw err;
            // 300ms, 900ms, 2700ms — enough for a Neon cold start to finish.
            await new Promise((r) => setTimeout(r, 300 * 3 ** attempt));
          }
        }
        throw lastError;
      },
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
