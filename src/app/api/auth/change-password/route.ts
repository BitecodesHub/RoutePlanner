import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createSessionToken,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { ApiError, getClientIp, requireUser, withErrorHandling } from "@/lib/http";
import { audit } from "@/lib/audit";
import { changePasswordSchema } from "@/lib/validation";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const session = await requireUser();
  const body = await req.json().catch(() => {
    throw new ApiError(400, "Invalid JSON body", "BAD_JSON");
  });
  const { currentPassword, newPassword } = changePasswordSchema.parse(body);

  const user = await prisma.user.findFirst({
    where: { id: session.id, deletedAt: null },
  });
  if (!user) {
    throw new ApiError(401, "Authentication required", "UNAUTHENTICATED");
  }

  const currentOk = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentOk) {
    throw new ApiError(400, "Current password is incorrect", "INVALID_CURRENT_PASSWORD");
  }

  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
    },
  });

  // The token-version bump invalidates every existing session, so issue a
  // fresh token carrying the new version to keep this user signed in.
  const token = await createSessionToken({
    id: updated.id,
    role: updated.role,
    tokenVersion: updated.tokenVersion,
  });
  await setSessionCookie(token);

  await audit({
    userId: user.id,
    action: "auth.change_password",
    entity: "User",
    entityId: user.id,
    ip: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
});
