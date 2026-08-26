import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, withErrorHandling } from "@/lib/http";
import { audit } from "@/lib/audit";
import { routeAssignedEmail } from "@/lib/mailer";
import { queueMail } from "@/lib/mail-queue";
import { formatDistance, formatDuration } from "@/lib/geo";
import { getBaseUrl } from "@/lib/base-url";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/routes/[id]/resend — re-send the assignment email to the driver. */
export const POST = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const admin = await requireRole("ADMIN");

  const route = await prisma.route.findFirst({
    where: { id, deletedAt: null },
    include: { stops: { select: { id: true } }, driver: true },
  });
  if (!route) throw new ApiError(404, "Route not found", "NOT_FOUND");
  if (!route.driver) {
    throw new ApiError(409, "Assign a driver before sending the route email", "NO_DRIVER");
  }

  const baseUrl = await getBaseUrl();
  queueMail(
    routeAssignedEmail({
      to: route.driver.email,
      driverName: route.driver.name,
      routeName: route.name,
      stopCount: route.stops.length,
      distanceText: formatDistance(route.totalDistanceM ?? 0),
      durationText: formatDuration(route.totalDurationS ?? 0),
      shareUrl: `${baseUrl}/share/${route.shareToken}`,
      scheduledFor: route.scheduledFor ? route.scheduledFor.toLocaleString() : undefined,
    }),
  );

  await audit({
    userId: admin.id,
    action: "route.resend_email",
    entity: "Route",
    entityId: route.id,
    detail: { to: route.driver.email },
    ip: getClientIp(req),
  });

  return NextResponse.json({ ok: true, sentTo: route.driver.email });
});
