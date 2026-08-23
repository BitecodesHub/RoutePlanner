import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type Role, type SessionUser } from "@/lib/auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as unknown as Record<string, unknown>, init);
}

export function errorResponse(status: number, message: string, code?: string): NextResponse {
  return NextResponse.json({ error: { message, code } }, { status });
}

/**
 * Wrap a route handler with uniform error handling. Zod errors become 400s
 * with field detail; ApiError carries its own status; anything else is a
 * sanitized 500 (no stack traces or internals leak to clients).
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return errorResponse(err.status, err.message, err.code);
      }
      if (err instanceof ZodError) {
        const detail = err.issues
          .map((i) => `${i.path.join(".") || "value"}: ${i.message}`)
          .join("; ");
        return errorResponse(400, `Validation failed — ${detail}`, "VALIDATION");
      }
      console.error("[api] unhandled error:", err);
      return errorResponse(500, "Internal server error", "INTERNAL");
    }
  };
}

/** Require a valid session; throws 401 otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Authentication required", "UNAUTHENTICATED");
  return user;
}

/** Require a valid session with one of the given roles; throws 403 otherwise. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new ApiError(403, "You do not have permission to perform this action", "FORBIDDEN");
  }
  return user;
}

export function getClientIp(req: Request): string | undefined {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? undefined;
}
