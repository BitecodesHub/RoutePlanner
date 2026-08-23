import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ApiError, getClientIp, withErrorHandling } from "@/lib/http";
import { audit } from "@/lib/audit";
import { resetPasswordSchema } from "@/lib/validation";
import { hashToken } from "@/lib/tokens";

const INVALID_LINK_MESSAGE = "This reset link is invalid or has expired";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => {
    throw new ApiError(400, "Invalid JSON body", "BAD_JSON");
  });
  const { token, newPassword } = resetPasswordSchema.parse(body);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  const now = new Date();
  if (
    !record ||
    record.usedAt !== null ||
    record.expiresAt <= now ||
    record.user.deletedAt !== null ||
    record.user.status !== "ACTIVE"
  ) {
    throw new ApiError(400, INVALID_LINK_MESSAGE, "INVALID_RESET_TOKEN");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    }),
  ]);

  await audit({
    userId: record.userId,
    action: "auth.reset_password",
    entity: "User",
    entityId: record.userId,
    ip: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
});
