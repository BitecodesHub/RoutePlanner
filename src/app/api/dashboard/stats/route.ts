import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, withErrorHandling } from "@/lib/http";
import { routeToListItem } from "@/lib/serialize";
import type { DashboardStatsDto } from "@/lib/types";

export const GET = withErrorHandling(async () => {
  await requireRole("ADMIN");

  const [
    totalShops,
    activeDrivers,
    totalRoutes,
    activeRoutes,
    completedRoutes,
    recentRoutes,
    recentImports,
    recentActivity,
  ] = await prisma.$transaction([
    prisma.shop.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.user.count({ where: { role: "DRIVER", status: "ACTIVE", deletedAt: null } }),
    prisma.route.count({ where: { deletedAt: null } }),
    prisma.route.count({ where: { deletedAt: null, status: { in: ["ASSIGNED", "IN_PROGRESS"] } } }),
    prisma.route.count({ where: { deletedAt: null, status: "COMPLETED" } }),
    prisma.route.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { driver: true, _count: { select: { stops: true } } },
    }),
    prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { user: true },
    }),
  ]);

  const dto: DashboardStatsDto = {
    totalShops,
    activeDrivers,
    totalRoutes,
    activeRoutes,
    completedRoutes,
    recentRoutes: recentRoutes.map(routeToListItem),
    recentImports: recentImports.map((b) => ({
      id: b.id,
      filename: b.filename,
      imported: b.imported,
      invalid: b.invalid,
      skippedDuplicates: b.skippedDuplicates,
      createdAt: b.createdAt.toISOString(),
    })),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      action: a.action,
      entity: a.entity,
      detail: a.detail,
      createdAt: a.createdAt.toISOString(),
      userName: a.user?.name ?? null,
    })),
  };
  return NextResponse.json(dto);
});
