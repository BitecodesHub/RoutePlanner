import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, withErrorHandling } from "@/lib/http";
import { parseShopsCsv, partitionAgainstExisting } from "@/lib/csv-import";
import { audit } from "@/lib/audit";
import type { ImportSummaryDto } from "@/lib/types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_STORED_ERRORS = 200;
const MAX_RESPONSE_ERRORS = 100;

export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await requireRole("ADMIN");

  const form = await req.formData();
  const entry = form.get("file");
  if (!entry || typeof entry === "string") {
    throw new ApiError(400, "A CSV file is required (multipart field \"file\")", "FILE_REQUIRED");
  }
  const file = entry as File;
  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError(413, "File too large — the maximum size is 5 MB", "FILE_TOO_LARGE");
  }

  const parsed = parseShopsCsv(await file.text());

  const existing = await prisma.shop.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, latitude: true, longitude: true, externalRef: true },
  });
  const { fresh, duplicates: dbDuplicates } = partitionAgainstExisting(parsed.valid, existing);

  const allErrors: { rowNumber: number; message: string }[] = [
    ...parsed.errors,
    ...parsed.duplicatesInFile,
    ...dbDuplicates.map((d) => ({
      rowNumber: d.row.rowNumber,
      message: `${d.row.name}: already exists`,
    })),
  ];

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.importBatch.create({
      data: {
        filename: file.name,
        totalRows: parsed.totalRows,
        imported: fresh.length,
        skippedDuplicates: parsed.duplicatesInFile.length + dbDuplicates.length,
        invalid: parsed.errors.length,
        errors: JSON.stringify(allErrors.slice(0, MAX_STORED_ERRORS)),
        createdById: user.id,
      },
    });
    if (fresh.length > 0) {
      await tx.shop.createMany({
        data: fresh.map((r) => ({
          name: r.name,
          address: r.address ?? null,
          latitude: r.latitude,
          longitude: r.longitude,
          contactName: r.contactName ?? null,
          phone: r.phone ?? null,
          email: r.email ?? null,
          notes: r.notes ?? null,
          externalRef: r.externalRef ?? null,
          importBatchId: created.id,
        })),
      });
    }
    return created;
  });

  await audit({
    userId: user.id,
    action: "shop.import",
    entity: "ImportBatch",
    entityId: batch.id,
    detail: {
      filename: file.name,
      totalRows: parsed.totalRows,
      imported: fresh.length,
      skippedDuplicates: parsed.duplicatesInFile.length + dbDuplicates.length,
      invalid: parsed.errors.length,
    },
    ip: getClientIp(req),
  });

  const summary: ImportSummaryDto = {
    batchId: batch.id,
    filename: file.name,
    totalRows: parsed.totalRows,
    imported: fresh.length,
    skippedDuplicates: parsed.duplicatesInFile.length + dbDuplicates.length,
    invalid: parsed.errors.length,
    errors: allErrors.slice(0, MAX_RESPONSE_ERRORS),
  };
  return NextResponse.json(summary, { status: 201 });
});
