import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, withErrorHandling } from "@/lib/http";
import { hashPassword } from "@/lib/auth";
import { tempPassword } from "@/lib/tokens";
import { driverWelcomeEmail } from "@/lib/mailer";
import { queueMail } from "@/lib/mail-queue";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/drivers/[id]/reset-credentials — issue a new temporary password (ADMIN). */
export const POST = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const admin = await requireRole("ADMIN");
  const { id } = await ctx.params;

  const driver = await prisma.user.findFirst({
    where: { id, role: "DRIVER", deletedAt: null },
  });
  if (!driver) throw new ApiError(404, "Driver not found", "NOT_FOUND");

  const plainPassword = tempPassword();
  const passwordHash = await hashPassword(plainPassword);

  await prisma.user.update({
    where: { id },
    data: {
      passwordHash,
      mustChangePassword: true,
      // Invalidate all existing sessions for this driver.
      tokenVersion: { increment: 1 },
    },
  });

  queueMail(
    driverWelcomeEmail({
      to: driver.email,
      name: driver.name,
      email: driver.email,
      tempPassword: plainPassword,
    }),
  );

  await audit({
    userId: admin.id,
    action: "driver.reset_credentials",
    entity: "User",
    entityId: id,
    ip: getClientIp(req),
  });

  return NextResponse.json({ tempPassword: plainPassword });
});
