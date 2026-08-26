import { headers } from "next/headers";

/**
 * Resolve the app's public base URL for links embedded in emails.
 *
 * Order:
 *  1. APP_BASE_URL if explicitly set (canonical override).
 *  2. The incoming request's forwarded host — correct on Vercel behind a
 *     custom domain, with zero config, so links always match the domain the
 *     admin is actually using (e.g. https://routepilot.bitecodes.com).
 *  3. VERCEL_PROJECT_PRODUCTION_URL (Vercel-injected fallback).
 *  4. localhost for local dev.
 *
 * Must be called within a request scope (all email sends are); the headers()
 * lookup is wrapped so it degrades gracefully if ever called outside one.
 */
export async function getBaseUrl(): Promise<string> {
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`.replace(/\/+$/, "");
    }
  } catch {
    // Not in a request scope — fall through.
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}
