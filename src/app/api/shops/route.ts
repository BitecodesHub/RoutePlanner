import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, withErrorHandling } from "@/lib/http";
import { shopCreateSchema, shopListQuerySchema } from "@/lib/validation";
import { haversineMeters, isValidCoordinate } from "@/lib/geo";
import { shopToDto } from "@/lib/serialize";
import { audit } from "@/lib/audit";
import type { Paginated, ShopDto } from "@/lib/types";

const DUPLICATE_RADIUS_M = 50;

export const GET = withErrorHandling(async (req: NextRequest) => {
  await requireRole("ADMIN");

  const query = shopListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

  const where: Prisma.ShopWhereInput = {
    deletedAt: null,
    ...(query.status !== "ALL" ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q } },
            { address: { contains: query.q } },
            { phone: { contains: query.q } },
            { externalRef: { contains: query.q } },
          ],
        }
      : {}),
  };

  const [total, shops] = await prisma.$transaction([
    prisma.shop.count({ where }),
    prisma.shop.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  const payload: Paginated<ShopDto> = {
    items: shops.map(shopToDto),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
  return NextResponse.json(payload);
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await requireRole("ADMIN");

  const body = (await req.json()) as Record<string, unknown>;
  const force = body?.force === true;
  const data = shopCreateSchema.parse(body);

  if (!isValidCoordinate(data.latitude, data.longitude)) {
    throw new ApiError(400, "Invalid coordinates", "INVALID_COORDINATES");
  }

  if (!force) {
    const externalRef = data.externalRef?.trim() || null;
    let duplicate: { id: string; name: string } | null = null;

    if (externalRef) {
      duplicate = await prisma.shop.findFirst({
        where: { deletedAt: null, externalRef },
        select: { id: true, name: true },
      });
    }

    if (!duplicate) {
      const trimmedName = data.name.trim();
      // SQLite `contains` is case-insensitive for ASCII; refine to exact
      // (case-insensitive) name equality in JS, then check proximity.
      const candidates = await prisma.shop.findMany({
        where: { deletedAt: null, name: { contains: trimmedName } },
        select: { id: true, name: true, latitude: true, longitude: true },
      });
      const nameKey = trimmedName.toLowerCase();
      duplicate =
        candidates.find(
          (c) =>
            c.name.trim().toLowerCase() === nameKey &&
            haversineMeters(
              { lat: data.latitude, lng: data.longitude },
              { lat: c.latitude, lng: c.longitude },
            ) <= DUPLICATE_RADIUS_M,
        ) ?? null;
    }

    if (duplicate) {
      throw new ApiError(
        409,
        `A shop matching this one already exists: "${duplicate.name}". Submit again with force to create anyway.`,
        "DUPLICATE",
      );
    }
  }

  const shop = await prisma.shop.create({
    data: {
      name: data.name,
      address: data.address ?? null,
      latitude: data.latitude,
      longitude: data.longitude,
      contactName: data.contactName ?? null,
      phone: data.phone ?? null,
      email: data.email ? data.email : null,
      notes: data.notes ?? null,
      externalRef: data.externalRef ?? null,
    },
  });

  await audit({
    userId: user.id,
    action: "shop.create",
    entity: "Shop",
    entityId: shop.id,
    detail: { name: shop.name, force },
    ip: getClientIp(req),
  });

  return NextResponse.json(shopToDto(shop), { status: 201 });
});
