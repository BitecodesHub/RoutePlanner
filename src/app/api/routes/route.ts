import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, requireUser, withErrorHandling } from "@/lib/http";
import { routeCreateSchema, routeListQuerySchema } from "@/lib/validation";
import { buildRoute } from "@/lib/route-service";
import { routeToDto, routeToListItem } from "@/lib/serialize";
import { secureToken } from "@/lib/tokens";
import { audit } from "@/lib/audit";
import type { Paginated, RouteListItemDto } from "@/lib/types";

export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await requireUser();
  const query = routeListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

  const conditions: Prisma.RouteWhereInput[] = [{ deletedAt: null }];
  if (user.role === "DRIVER") {
    conditions.push({ driverId: user.id }, { status: { not: "DRAFT" } });
  } else if (query.driverId) {
    conditions.push({ driverId: query.driverId });
  }
  if (query.status !== "ALL") {
    conditions.push({ status: query.status });
  }
  if (query.q) {
    conditions.push({ name: { contains: query.q, mode: "insensitive" } });
  }
  const where: Prisma.RouteWhereInput = { AND: conditions };

  const [total, routes] = await prisma.$transaction([
    prisma.route.count({ where }),
    prisma.route.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { driver: true, _count: { select: { stops: true } } },
    }),
  ]);

  const body: Paginated<RouteListItemDto> = {
    items: routes.map(routeToListItem),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
  return NextResponse.json(body);
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const admin = await requireRole("ADMIN");
  const body = routeCreateSchema.parse(await req.json());

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

  // findMany does not preserve the request order — reorder to match shopIds.
  const byId = new Map(shops.map((s) => [s.id, s]));
  const orderedInput = uniqueShopIds.map((id) => byId.get(id)!);

  const built = await buildRoute(
    { lat: body.start.lat, lng: body.start.lng },
    orderedInput.map((s) => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude })),
    { keepOrder: body.manualOrder },
  );

  const routeId = await prisma.$transaction(async (tx) => {
    const route = await tx.route.create({
      data: {
        name: body.name,
        status: "DRAFT",
        startLat: body.start.lat,
        startLng: body.start.lng,
        startLabel: body.start.label ?? null,
        totalDistanceM: built.totalDistanceM,
        totalDurationS: built.totalDurationS,
        geometry: JSON.stringify(built.geometry),
        distanceSource: built.distanceSource,
        scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
        shareToken: secureToken(),
        notes: body.notes ?? null,
        createdById: admin.id,
      },
    });
    await tx.routeStop.createMany({
      data: built.stops.map((st) => ({
        routeId: route.id,
        shopId: st.shopId,
        sequence: st.sequence,
        legDistanceM: st.legDistanceM,
        legDurationS: st.legDurationS,
      })),
    });
    return route.id;
  });

  await audit({
    userId: admin.id,
    action: "route.create",
    entity: "Route",
    entityId: routeId,
    detail: { name: body.name, stops: built.stops.length, manualOrder: body.manualOrder },
    ip: getClientIp(req),
  });

  const full = await prisma.route.findUniqueOrThrow({
    where: { id: routeId },
    include: { stops: { include: { shop: true } }, driver: true },
  });
  return NextResponse.json(routeToDto(full), { status: 201 });
});
