import { NextResponse } from "next/server";
import { requireUser, withErrorHandling } from "@/lib/http";
import type { SessionDto } from "@/lib/types";

export const GET = withErrorHandling(async () => {
  const user = await requireUser();
  const dto: SessionDto = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
  return NextResponse.json(dto);
});
