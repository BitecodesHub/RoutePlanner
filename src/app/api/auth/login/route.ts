import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createSessionToken,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { ApiError, getClientIp, withErrorHandling } from "@/lib/http";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";
import type { SessionDto } from "@/lib/types";

/**
 * Dummy bcrypt hash used when the account does not exist, so the request
 * still pays the full password-verification cost (timing-safe-ish).
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("not-a-real-password");
  return dummyHashPromise;
}

const GENERIC_MESSAGE = "Invalid email or password";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => {
    throw new ApiError(400, "Invalid JSON body", "BAD_JSON");
  });
  const { email, password } = loginSchema.parse(body);
  const ip = getClientIp(req) ?? "unknown";

  const limit = rateLimit(`login:${ip}:${email.toLowerCase()}`, 5, 15 * 60_000);
  if (!limit.allowed) {
    throw new ApiError(
      429,
      `Too many login attempts. Please try again in ${limit.retryAfterSeconds} seconds.`,
      "RATE_LIMITED",
    );
  }

  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
  });

  if (!user) {
    // Burn comparable time even when the account does not exist.
    await verifyPassword(password, await getDummyHash());
    throw new ApiError(401, GENERIC_MESSAGE, "INVALID_CREDENTIALS");
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk || user.status !== "ACTIVE") {
    throw new ApiError(401, GENERIC_MESSAGE, "INVALID_CREDENTIALS");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = await createSessionToken({
    id: user.id,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });
  await setSessionCookie(token);

  await audit({
    userId: user.id,
    action: "auth.login",
    entity: "User",
    entityId: user.id,
    ip,
  });

  const dto: SessionDto = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionDto["role"],
    mustChangePassword: user.mustChangePassword,
  };
  return NextResponse.json(dto);
});
