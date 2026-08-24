import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireUser, withErrorHandling } from "@/lib/http";
import { routeStatusSchema } from "@/lib/validation";
import { routeToDto } from "@/lib/serialize";
import { audit } from "@/lib/audit";
import { routeStatusEmail, sendMail } from "@/lib/mailer";

type Ctx = { params: Promise<{ id: string }> };

const NON_TERMINAL = ["DRAFT", "ASSIGNED", "IN_PROGRESS"];

export const POST = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const body = routeStatusSchema.parse(await req.json());

  const route = await prisma.route.findFirst({
    where: { id, deletedAt: null },
    include: { driver: true, createdBy: true },
  });
  if (!route) throw new ApiError(404, "Route not found", "NOT_FOUND");
  if (user.role === "DRIVER" && route.driverId !== user.id) {
    throw new ApiError(404, "Route not found", "NOT_FOUND");
  }

  const from = route.status;
  const to = body.status;

  let allowed: boolean;
  if (user.role === "ADMIN") {
    allowed =
      (from === "ASSIGNED" && to === "IN_PROGRESS") ||
      (from === "IN_PROGRESS" && to === "COMPLETED") ||
      (to === "CANCELLED" && NON_TERMINAL.includes(from)) ||
      (from === "CANCELLED" && to === "DRAFT");
  } else {
    allowed =
      (from === "ASSIGNED" && to === "IN_PROGRESS") ||
      (from === "IN_PROGRESS" && to === "COMPLETED");
  }
  if (!allowed) {
    throw new ApiError(
      409,
      `Cannot change route status from ${from} to ${to}`,
      "INVALID_TRANSITION",
    );
  }

  const data: Prisma.RouteUpdateInput = { status: to };
  if (to === "IN_PROGRESS" && !route.startedAt) data.startedAt = new Date();
  if (to === "COMPLETED") data.completedAt = new Date();

  if (from === "CANCELLED" && to === "DRAFT") {
    // Reopening returns the route to a clean draft: no stale assignment,
    // timestamps, or stop progress from the cancelled run.
    data.driver = { disconnect: true };
    data.assignedAt = null;
    data.startedAt = null;
    data.completedAt = null;
    await prisma.$transaction([
      prisma.route.update({ where: { id: route.id }, data }),
      prisma.routeStop.updateMany({
        where: { routeId: route.id },
        data: { status: "PENDING", arrivedAt: null, completedAt: null },
      }),
    ]);
  } else {
    await prisma.route.update({ where: { id: route.id }, data });
  }

  // Notify the other party on terminal transitions.
  if (to === "COMPLETED" || to === "CANCELLED") {
    if (user.role === "DRIVER") {
      void sendMail(
        routeStatusEmail({
          to: route.createdBy.email,
          routeName: route.name,
          status: to,
          detail: `Updated by driver ${route.driver?.name ?? user.name}.`,
        }),
      );
    } else if (route.driver) {
      void sendMail(
        routeStatusEmail({ to: route.driver.email, routeName: route.name, status: to }),
      );
    }
  }

  await audit({
    userId: user.id,
    action: "route.status",
    entity: "Route",
    entityId: route.id,
    detail: { from, to },
    ip: getClientIp(req),
  });

  const fresh = await prisma.route.findUniqueOrThrow({
    where: { id: route.id },
    include: { stops: { include: { shop: true } }, driver: true },
  });
  return NextResponse.json(routeToDto(fresh));
});
