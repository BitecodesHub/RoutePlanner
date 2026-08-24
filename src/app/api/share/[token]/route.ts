import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, withErrorHandling } from "@/lib/http";
import { routeToDto } from "@/lib/serialize";

type Ctx = { params: Promise<{ token: string }> };

/**
 * PUBLIC endpoint — no auth. The unguessable share token is the credential.
 * The payload is redacted for navigation use: no driver contact details and
 * no CRM data (shop notes / emails).
 */
export const GET = withErrorHandling(async (_req: NextRequest, ctx: Ctx) => {
  const { token } = await ctx.params;

  const route = await prisma.route.findFirst({
    where: { shareToken: token, deletedAt: null },
    include: { stops: { include: { shop: true } }, driver: true },
  });
  if (!route) throw new ApiError(404, "Route not found", "NOT_FOUND");

  const dto = routeToDto(route);
  dto.driver = dto.driver ? { id: "", name: dto.driver.name, email: "", phone: null } : null;
  // Redact everything the share page does not need for navigation: contact
  // details and source-system references stay private.
  dto.stops = dto.stops.map((st) => ({
    ...st,
    shop: {
      ...st.shop,
      notes: null,
      email: null,
      phone: null,
      contactName: null,
      externalRef: null,
    },
  }));

  return NextResponse.json(dto);
});
