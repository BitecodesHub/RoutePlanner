import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, withErrorHandling } from "@/lib/http";

export const GET = withErrorHandling(async () => {
  await requireRole("ADMIN");

  const batches = await prisma.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json(
    batches.map((b) => ({
      id: b.id,
      filename: b.filename,
      totalRows: b.totalRows,
      imported: b.imported,
      skippedDuplicates: b.skippedDuplicates,
      invalid: b.invalid,
      createdAt: b.createdAt.toISOString(),
    })),
  );
});
