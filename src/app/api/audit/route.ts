import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, withErrorHandling } from "@/lib/http";
import type { Paginated } from "@/lib/types";

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

interface AuditLogItem {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
  userName: string | null;
}

export const GET = withErrorHandling(async (req: NextRequest) => {
  await requireRole("ADMIN");
  const query = auditQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

  const [total, logs] = await prisma.$transaction([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { user: true },
    }),
  ]);

  const body: Paginated<AuditLogItem> = {
    items: logs.map((l) => ({
      id: l.id,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      detail: l.detail,
      ip: l.ip,
      createdAt: l.createdAt.toISOString(),
      userName: l.user?.name ?? null,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
  return NextResponse.json(body);
});
