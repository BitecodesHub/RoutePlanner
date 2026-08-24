import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, withErrorHandling } from "@/lib/http";
import { driverUpdateSchema } from "@/lib/validation";
import { driverToDto, routeToListItem } from "@/lib/serialize";
import { audit } from "@/lib/audit";

const ACTIVE_ROUTE_STATUSES = ["ASSIGNED", "IN_PROGRESS"];

type Ctx = { params: Promise<{ id: string }> };

async function findDriverOr404(id: string) {
  const driver = await prisma.user.findFirst({
    where: { id, role: "DRIVER", deletedAt: null },
  });
  if (!driver) throw new ApiError(404, "Driver not found", "NOT_FOUND");
  return driver;
}

/** GET /api/drivers/[id] — driver detail with their 20 most recent routes (ADMIN). */
export const GET = withErrorHandling(async (_req: NextRequest, ctx: Ctx) => {
  await requireRole("ADMIN");
  const { id } = await ctx.params;
  const driver = await findDriverOr404(id);

  const [activeRouteCount, routes] = await Promise.all([
    prisma.route.count({
      where: { driverId: id, status: { in: ACTIVE_ROUTE_STATUSES }, deletedAt: null },
    }),
    prisma.route.findMany({
      where: { driverId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { driver: true, _count: { select: { stops: true } } },
    }),
  ]);

  return NextResponse.json({
    driver: driverToDto(driver, activeRouteCount),
    routes: routes.map(routeToListItem),
  });
});

/** PATCH /api/drivers/[id] — update a driver's profile or status (ADMIN). */
export const PATCH = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const admin = await requireRole("ADMIN");
  const { id } = await ctx.params;
  const body = driverUpdateSchema.parse(await req.json());
  const driver = await findDriverOr404(id);

  if (body.email !== undefined && body.email !== driver.email) {
    const existing = await prisma.user.findFirst({
      where: { email: body.email, deletedAt: null, id: { not: id } },
      select: { id: true },
    });
    if (existing) {
      throw new ApiError(409, "A user with this email already exists", "EMAIL_TAKEN");
    }
  }

  const data: Prisma.UserUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.email !== undefined) data.email = body.email;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.status !== undefined) {
    data.status = body.status;
    // Deactivating a driver invalidates all of their existing sessions.
    if (body.status === "INACTIVE") data.tokenVersion = { increment: 1 };
  }

  let updated;
  try {
    updated = await prisma.user.update({ where: { id }, data });
  } catch (err) {
    // The email column is unique across all rows (including soft-deleted ones).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ApiError(409, "A user with this email already exists", "EMAIL_TAKEN");
    }
    throw err;
  }

  await audit({
    userId: admin.id,
    action: "driver.update",
    entity: "User",
    entityId: id,
    detail: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    },
    ip: getClientIp(req),
  });

  return NextResponse.json(driverToDto(updated));
});

/** DELETE /api/drivers/[id] — soft-delete a driver and free their unstarted routes (ADMIN). */
export const DELETE = withErrorHandling(async (req: NextRequest, ctx: Ctx) => {
  const admin = await requireRole("ADMIN");
  const { id } = await ctx.params;
  const driver = await findDriverOr404(id);

  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: "INACTIVE",
        tokenVersion: { increment: 1 },
        // Free the address for future accounts — the global unique index
        // also covers soft-deleted rows. Original is kept in the audit log.
        email: `deleted-${id}-${driver.email}`,
      },
    }),
    // Unassign routes that have not started yet; keep IN_PROGRESS/COMPLETED history intact.
    prisma.route.updateMany({
      where: { driverId: id, status: { in: ["DRAFT", "ASSIGNED"] }, deletedAt: null },
      data: { driverId: null, status: "DRAFT", assignedAt: null },
    }),
  ]);

  await audit({
    userId: admin.id,
    action: "driver.delete",
    entity: "User",
    entityId: id,
    detail: { email: driver.email },
    ip: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
});
