import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireUser, withErrorHandling } from "@/lib/http";
import { stopStatusSchema } from "@/lib/validation";
import { routeToDto } from "@/lib/serialize";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string; stopId: string }> };

export const PATCH = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const { id, stopId } = await ctx.params;
  const user = await requireUser();
  const body = stopStatusSchema.parse(await req.json());

  const route = await prisma.route.findFirst({ where: { id, deletedAt: null } });
  if (!route) throw new ApiError(404, "Route not found", "NOT_FOUND");

  if (user.role === "DRIVER") {
    if (route.driverId !== user.id) {
      throw new ApiError(404, "Route not found", "NOT_FOUND");
    }
    if (route.status !== "IN_PROGRESS") {
      throw new ApiError(409, "Start the route before updating stops", "ROUTE_NOT_STARTED");
    }
  }

  const stop = await prisma.routeStop.findFirst({ where: { id: stopId, routeId: route.id } });
  if (!stop) throw new ApiError(404, "Stop not found", "NOT_FOUND");

  const data: Prisma.RouteStopUpdateInput = { status: body.status };
  if (body.status === "ARRIVED") {
    if (!stop.arrivedAt) data.arrivedAt = new Date();
  } else if (body.status === "COMPLETED") {
    data.completedAt = new Date();
  } else if (body.status === "PENDING") {
    data.arrivedAt = null;
    data.completedAt = null;
  }
  if (body.notes !== undefined) data.notes = body.notes;

  await prisma.routeStop.update({ where: { id: stop.id }, data });

  await audit({
    userId: user.id,
    action: "route.stop_status",
    entity: "RouteStop",
    entityId: stop.id,
    detail: { routeId: route.id, from: stop.status, to: body.status },
    ip: getClientIp(req),
  });

  const fresh = await prisma.route.findUniqueOrThrow({
    where: { id: route.id },
    include: { stops: { include: { shop: true } }, driver: true },
  });
  return NextResponse.json(routeToDto(fresh));
});
