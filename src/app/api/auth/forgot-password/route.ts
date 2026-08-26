import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, withErrorHandling } from "@/lib/http";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/lib/validation";
import { hashToken, secureToken } from "@/lib/tokens";
import { passwordResetEmail } from "@/lib/mailer";
import { queueMail } from "@/lib/mail-queue";
import { getBaseUrl } from "@/lib/base-url";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Always responds {ok:true} regardless of whether the account exists, so the
 * endpoint cannot be used for account enumeration.
 */
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => {
    throw new ApiError(400, "Invalid JSON body", "BAD_JSON");
  });
  const { email } = forgotPasswordSchema.parse(body);
  const ip = getClientIp(req) ?? "unknown";

  // Two windows: per IP+account, and per account alone. The second cannot be
  // bypassed by spoofing X-Forwarded-For, capping reset-mail flooding.
  const perIp = rateLimit(`forgot:${ip}:${email.toLowerCase()}`, 3, 15 * 60_000);
  const perAccount = rateLimit(`forgot-acct:${email.toLowerCase()}`, 5, 15 * 60_000);
  if (!perIp.allowed || !perAccount.allowed) {
    // Silently drop the request: same response shape, no work performed.
    return NextResponse.json({ ok: true });
  }

  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null, status: "ACTIVE" },
  });

  if (user) {
    const raw = secureToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const baseUrl = await getBaseUrl();
    const resetUrl = `${baseUrl}/reset-password?token=${raw}`;
    queueMail(passwordResetEmail({ to: user.email, name: user.name, resetUrl }));

    await audit({
      userId: user.id,
      action: "auth.forgot_password",
      entity: "User",
      entityId: user.id,
      ip,
    });
  }

  return NextResponse.json({ ok: true });
});
