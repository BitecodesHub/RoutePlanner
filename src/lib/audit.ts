import { prisma } from "@/lib/db";

/**
 * Record an audit event. Audit writes must never break the main operation,
 * so failures are logged and swallowed.
 */
export async function audit(entry: {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  detail?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        detail: entry.detail ? JSON.stringify(entry.detail) : undefined,
        ip: entry.ip,
      },
    });
  } catch (err) {
    console.error("[audit] failed to record event", entry.action, err);
  }
}
