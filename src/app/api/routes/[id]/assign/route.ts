import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, withErrorHandling } from "@/lib/http";
import { routeAssignSchema } from "@/lib/validation";
import { routeToDto } from "@/lib/serialize";
import { audit } from "@/lib/audit";
import { routeAssignedEmail } from "@/lib/mailer";
import { queueMail } from "@/lib/mail-queue";
import { formatDistance, formatDuration } from "@/lib/geo";
import { getBaseUrl } from "@/lib/base-url";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const admin = await requireRole("ADMIN");
  const body = routeAssignSchema.parse(await req.json());

  const route = await prisma.route.findFirst({ where: { id, deletedAt: null } });
  if (!route) throw new ApiError(404, "Route not found", "NOT_FOUND");
  if (route.status !== "DRAFT" && route.status !== "ASSIGNED") {
    throw new ApiError(409, "Only draft or assigned routes can be (re)assigned", "ROUTE_LOCKED");
  }

  if (body.driverId === null) {
    await prisma.route.update({
      where: { id: route.id },
      data: { driverId: null, assignedAt: null, status: "DRAFT" },
    });
  } else {
    const driver = await prisma.user.findFirst({
      where: { id: body.driverId, role: "DRIVER", status: "ACTIVE", deletedAt: null },
    });
    if (!driver) {
      throw new ApiError(400, "Driver not found or inactive", "INVALID_DRIVER");
    }
    await prisma.route.update({
      where: { id: route.id },
      data: { driverId: driver.id, assignedAt: new Date(), status: "ASSIGNED" },
    });
  }

  const updated = await prisma.route.findUniqueOrThrow({
    where: { id: route.id },
    include: { stops: { include: { shop: true } }, driver: true },
  });

  if (updated.driver) {
    const baseUrl = await getBaseUrl();
    queueMail(
      routeAssignedEmail({
        to: updated.driver.email,
        driverName: updated.driver.name,
        routeName: updated.name,
        stopCount: updated.stops.length,
        distanceText: formatDistance(updated.totalDistanceM ?? 0),
        durationText: formatDuration(updated.totalDurationS ?? 0),
        shareUrl: `${baseUrl}/share/${updated.shareToken}`,
        scheduledFor: updated.scheduledFor ? updated.scheduledFor.toLocaleString() : undefined,
      }),
    );
  }

  await audit({
    userId: admin.id,
    action: "route.assign",
    entity: "Route",
    entityId: route.id,
    detail: { driverId: body.driverId },
    ip: getClientIp(req),
  });

  return NextResponse.json(routeToDto(updated));
});
