import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, requireRole, withErrorHandling } from "@/lib/http";
import { optimizePreviewSchema } from "@/lib/validation";
import { buildRoute } from "@/lib/route-service";
import type { OptimizePreviewDto } from "@/lib/types";

export const POST = withErrorHandling(async (req: NextRequest) => {
  await requireRole("ADMIN");
  const body = optimizePreviewSchema.parse(await req.json());

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

  const built = await buildRoute(
    { lat: body.start.lat, lng: body.start.lng },
    shops.map((s) => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude })),
    { keepOrder: false },
  );

  const dto: OptimizePreviewDto = {
    orderedShopIds: built.orderedShops.map((s) => s.id),
    totalDistanceM: built.totalDistanceM,
    totalDurationS: built.totalDurationS,
    distanceSource: built.distanceSource,
    geometry: built.geometry,
    legs: built.stops.map((st) => ({
      shopId: st.shopId,
      legDistanceM: st.legDistanceM,
      legDurationS: st.legDurationS,
    })),
  };
  return NextResponse.json(dto);
});
