import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, requireUser, withErrorHandling } from "@/lib/http";
import { routeUpdateSchema } from "@/lib/validation";
import { buildRoute, type ShopPoint } from "@/lib/route-service";
import { routeToDto } from "@/lib/serialize";
import { audit } from "@/lib/audit";
import { routeStatusEmail } from "@/lib/mailer";
import { queueMail } from "@/lib/mail-queue";

type Ctx = { params: Promise<{ id: string }> };

const FULL_INCLUDE = { stops: { include: { shop: true } }, driver: true } as const;

export const GET = withErrorHandling(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();

  const route = await prisma.route.findFirst({
    where: { id, deletedAt: null },
    include: FULL_INCLUDE,
  });
  if (!route) throw new ApiError(404, "Route not found", "NOT_FOUND");
  if (user.role === "DRIVER" && route.driverId !== user.id) {
    // Do not leak existence of other drivers' routes.
    throw new ApiError(404, "Route not found", "NOT_FOUND");
  }
  return NextResponse.json(routeToDto(route));
});

export const PATCH = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const admin = await requireRole("ADMIN");
  const body = routeUpdateSchema.parse(await req.json());

  const route = await prisma.route.findFirst({
    where: { id, deletedAt: null },
    include: { stops: { include: { shop: true }, orderBy: { sequence: "asc" } } },
  });
  if (!route) throw new ApiError(404, "Route not found", "NOT_FOUND");
  if (route.status !== "DRAFT" && route.status !== "ASSIGNED") {
    throw new ApiError(409, "Only draft or assigned routes can be edited", "ROUTE_LOCKED");
  }

  const data: Prisma.RouteUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.scheduledFor !== undefined) {
    data.scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
  }
  if (body.notes !== undefined) data.notes = body.notes ?? null;

  const rebuild = body.shopIds !== undefined || body.reoptimize === true || body.start !== undefined;

  if (rebuild) {
    const newStart = body.start ?? {
      lat: route.startLat,
      lng: route.startLng,
      label: route.startLabel ?? undefined,
    };

    let shopPoints: ShopPoint[];
    if (body.shopIds !== undefined) {
      const uniqueShopIds = [...new Set(body.shopIds)];
      const shops = await prisma.shop.findMany({
        where: { id: { in: uniqueShopIds }, deletedAt: null, status: "ACTIVE" },
      });
      if (shops.length !== uniqueShopIds.length) {
        const missing = uniqueShopIds.length - shops.length;
        throw new ApiError(
          400,
          `${missing} of the selected shop${missing === 1 ? " was" : "s were"} not found or inactive`,
          "SHOPS_NOT_FOUND",
        );
      }
      const byId = new Map(shops.map((s) => [s.id, s]));
      shopPoints = uniqueShopIds.map((sid) => {
        const s = byId.get(sid)!;
        return { id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude };
      });
    } else {
      shopPoints = route.stops.map((st) => ({
        id: st.shop.id,
        name: st.shop.name,
        latitude: st.shop.latitude,
        longitude: st.shop.longitude,
      }));
    }

    const keepOrder = !body.reoptimize;
    const built = await buildRoute(
      { lat: newStart.lat, lng: newStart.lng },
      shopPoints,
      { keepOrder },
    );

    data.startLat = newStart.lat;
    data.startLng = newStart.lng;
    data.startLabel = newStart.label ?? null;
    data.totalDistanceM = built.totalDistanceM;
    data.totalDurationS = built.totalDurationS;
    data.geometry = JSON.stringify(built.geometry);
    data.distanceSource = built.distanceSource;

    await prisma.$transaction(async (tx) => {
      // Re-verify the editability guard inside the transaction: buildRoute
      // awaits slow external calls, so the pre-check above may be stale
      // (e.g. the driver started the route in the meantime).
      const { count } = await tx.route.updateMany({
        where: { id: route.id, status: { in: ["DRAFT", "ASSIGNED"] }, deletedAt: null },
        data: data as Prisma.RouteUpdateManyMutationInput,
      });
      if (count === 0) {
        throw new ApiError(409, "Only draft or assigned routes can be edited", "ROUTE_LOCKED");
      }
      await tx.routeStop.deleteMany({ where: { routeId: route.id } });
      // Fresh PENDING stops — editing a route restarts its plan.
      await tx.routeStop.createMany({
        data: built.stops.map((st) => ({
          routeId: route.id,
          shopId: st.shopId,
          sequence: st.sequence,
          legDistanceM: st.legDistanceM,
          legDurationS: st.legDurationS,
        })),
      });
    });
  } else {
    const { count } = await prisma.route.updateMany({
      where: { id: route.id, status: { in: ["DRAFT", "ASSIGNED"] }, deletedAt: null },
      data: data as Prisma.RouteUpdateManyMutationInput,
    });
    if (count === 0) {
      throw new ApiError(409, "Only draft or assigned routes can be edited", "ROUTE_LOCKED");
    }
  }

  await audit({
    userId: admin.id,
    action: "route.update",
    entity: "Route",
    entityId: route.id,
    detail: { rebuild, reoptimize: body.reoptimize === true },
    ip: getClientIp(req),
  });

  const fresh = await prisma.route.findUniqueOrThrow({
    where: { id: route.id },
    include: FULL_INCLUDE,
  });
  return NextResponse.json(routeToDto(fresh));
});

export const DELETE = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const admin = await requireRole("ADMIN");

  const route = await prisma.route.findFirst({
    where: { id, deletedAt: null },
    include: { driver: true },
  });
  if (!route) throw new ApiError(404, "Route not found", "NOT_FOUND");

  const wasActive = route.status === "ASSIGNED" || route.status === "IN_PROGRESS";
  await prisma.route.update({
    where: { id: route.id },
    data: {
      deletedAt: new Date(),
      ...(wasActive ? { status: "CANCELLED" } : {}),
    },
  });

  if (wasActive && route.driver) {
    queueMail(
      routeStatusEmail({ to: route.driver.email, routeName: route.name, status: "CANCELLED" }),
    );
  }

  await audit({
    userId: admin.id,
    action: "route.delete",
    entity: "Route",
    entityId: route.id,
    detail: { name: route.name, previousStatus: route.status },
    ip: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
});
