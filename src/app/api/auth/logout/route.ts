import { type NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth";
import { getClientIp, withErrorHandling } from "@/lib/http";
import { audit } from "@/lib/audit";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await getCurrentUser();
  await clearSessionCookie();

  await audit({
    userId: user?.id,
    action: "auth.logout",
    entity: "User",
    entityId: user?.id,
    ip: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
});
