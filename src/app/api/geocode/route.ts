import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireRole, withErrorHandling } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { resolveLocation, searchAddress } from "@/lib/geocode";
import type { GeocodeResultDto } from "@/lib/types";

const resolveSchema = z.object({
  input: z.string().trim().min(1).max(500),
});

export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await requireRole("ADMIN");

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    throw new ApiError(400, "Query must be at least 2 characters", "QUERY_TOO_SHORT");
  }

  const limit = rateLimit(`geocode:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    throw new ApiError(
      429,
      `Too many location searches, try again in ${limit.retryAfterSeconds}s`,
      "RATE_LIMITED",
    );
  }

  let results: GeocodeResultDto[];
  try {
    results = await searchAddress(q, 6);
  } catch {
    throw new ApiError(502, "Location service is unavailable, enter coordinates directly", "GEOCODER_DOWN");
  }
  return NextResponse.json({ results });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  await requireRole("ADMIN");
  const body = resolveSchema.parse(await req.json());

  try {
    const { result, candidates } = await resolveLocation(body.input);
    // A null result is a valid answer (input could not be resolved).
    return NextResponse.json({ result, candidates: candidates ?? [] });
  } catch {
    throw new ApiError(502, "Location service is unavailable, enter coordinates directly", "GEOCODER_DOWN");
  }
});
