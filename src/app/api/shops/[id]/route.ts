import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, withErrorHandling } from "@/lib/http";
import { shopUpdateSchema } from "@/lib/validation";
import { isValidCoordinate } from "@/lib/geo";
import { shopToDto } from "@/lib/serialize";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

async function findShopOr404(id: string) {
  const shop = await prisma.shop.findFirst({ where: { id, deletedAt: null } });
  if (!shop) throw new ApiError(404, "Shop not found", "NOT_FOUND");
  return shop;
}

export const GET = withErrorHandling(async (_req: NextRequest, ctx: Ctx) => {
  await requireRole("ADMIN");
  const { id } = await ctx.params;
  const shop = await findShopOr404(id);
  return NextResponse.json(shopToDto(shop));
});

export const PATCH = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireRole("ADMIN");
  const { id } = await ctx.params;
  const shop = await findShopOr404(id);

  const data = shopUpdateSchema.parse(await req.json());

  if (data.latitude !== undefined || data.longitude !== undefined) {
    const lat = data.latitude ?? shop.latitude;
    const lng = data.longitude ?? shop.longitude;
    if (!isValidCoordinate(lat, lng)) {
      throw new ApiError(400, "Invalid coordinates", "INVALID_COORDINATES");
    }
  }

  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: {
      name: data.name,
      address: data.address,
      latitude: data.latitude,
      longitude: data.longitude,
      contactName: data.contactName,
      phone: data.phone,
      email: data.email === "" ? null : data.email,
      notes: data.notes,
      externalRef: data.externalRef,
      status: data.status,
    },
  });

  await audit({
    userId: user.id,
    action: "shop.update",
    entity: "Shop",
    entityId: updated.id,
    detail: { fields: Object.keys(data) },
    ip: getClientIp(req),
  });

  return NextResponse.json(shopToDto(updated));
});

export const DELETE = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireRole("ADMIN");
  const { id } = await ctx.params;
  const shop = await findShopOr404(id);

  // Soft delete only — historical routes keep referencing this shop's stops.
  await prisma.shop.update({
    where: { id: shop.id },
    data: { deletedAt: new Date(), status: "INACTIVE" },
  });

  await audit({
    userId: user.id,
    action: "shop.delete",
    entity: "Shop",
    entityId: shop.id,
    detail: { name: shop.name },
    ip: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
});
