import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, getClientIp, requireRole, withErrorHandling } from "@/lib/http";
import { normalizeShopName, parseShopsCsv, type ParsedShopRow } from "@/lib/csv-import";
import { haversineMeters, isValidCoordinate } from "@/lib/geo";
import { audit } from "@/lib/audit";
import { shopToDto } from "@/lib/serialize";
import type { ImportSelectSummaryDto } from "@/lib/types";

/**
 * Route-planner import: takes a CSV (converted client-side from a loading
 * slip / Excel sheet), matches each party against existing shops, creates
 * shops for unmatched rows that carry valid coordinates, and returns the full
 * shop records so the planner can select them. Rows without coordinates and
 * without a database match are reported back as skipped — they cannot be
 * routed.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;

interface ShopRecordLite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  externalRef: string | null;
}

function matchExisting(
  row: ParsedShopRow,
  byRef: Map<string, ShopRecordLite>,
  byName: Map<string, ShopRecordLite[]>,
): ShopRecordLite | null {
  if (row.externalRef) {
    const refHit = byRef.get(row.externalRef);
    if (refHit) return refHit;
  }
  const candidates = byName.get(normalizeShopName(row.name)) ?? [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1 || !isValidCoordinate(row.latitude, row.longitude)) {
    return candidates[0];
  }
  // Same name at multiple locations — pick the one nearest the row's pin.
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = haversineMeters(
      { lat: row.latitude, lng: row.longitude },
      { lat: c.latitude, lng: c.longitude },
    );
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

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

  const parsed = parseShopsCsv(await file.text(), { requireCoords: false });
  const rows = [...parsed.valid, ...parsed.coordless].sort((a, b) => a.rowNumber - b.rowNumber);
  if (rows.length > MAX_ROWS) {
    throw new ApiError(422, `Too many rows — the maximum per import is ${MAX_ROWS}`, "TOO_MANY_ROWS");
  }

  const existing = await prisma.shop.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true, latitude: true, longitude: true, externalRef: true },
  });
  const byRef = new Map<string, ShopRecordLite>();
  const byName = new Map<string, ShopRecordLite[]>();
  for (const s of existing) {
    if (s.externalRef) byRef.set(s.externalRef, s);
    const key = normalizeShopName(s.name);
    const list = byName.get(key) ?? [];
    list.push(s);
    byName.set(key, list);
  }

  const matchedIds = new Set<string>();
  const toCreate: ParsedShopRow[] = [];
  const skipped: { rowNumber: number; name: string; reason: string }[] = [];

  for (const row of rows) {
    const hit = matchExisting(row, byRef, byName);
    if (hit) {
      matchedIds.add(hit.id);
    } else if (isValidCoordinate(row.latitude, row.longitude)) {
      toCreate.push(row);
    } else {
      skipped.push({
        rowNumber: row.rowNumber,
        name: row.name,
        reason: "Not in the shop list and no coordinates — add the shop (or its coordinates) first",
      });
    }
  }

  let createdIds: string[] = [];
  if (toCreate.length > 0) {
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          filename: file.name,
          totalRows: parsed.totalRows,
          imported: toCreate.length,
          skippedDuplicates: parsed.duplicatesInFile.length + matchedIds.size,
          invalid: parsed.errors.length + skipped.length,
          errors: JSON.stringify(parsed.errors.slice(0, 200)),
          createdById: user.id,
        },
      });
      await tx.shop.createMany({
        data: toCreate.map((r) => ({
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
      return created;
    });
    const createdShops = await prisma.shop.findMany({
      where: { importBatchId: batch.id },
      select: { id: true },
    });
    createdIds = createdShops.map((s) => s.id);
  }

  await audit({
    userId: user.id,
    action: "shop.importSelect",
    entity: "Shop",
    detail: {
      filename: file.name,
      totalRows: parsed.totalRows,
      matched: matchedIds.size,
      created: createdIds.length,
      skipped: skipped.length,
      invalid: parsed.errors.length,
    },
    ip: getClientIp(req),
  });

  const shopRecords = await prisma.shop.findMany({
    where: { id: { in: [...matchedIds, ...createdIds] }, deletedAt: null },
  });

  const summary: ImportSelectSummaryDto = {
    filename: file.name,
    totalRows: parsed.totalRows,
    matched: matchedIds.size,
    created: createdIds.length,
    shops: shopRecords.map(shopToDto),
    skipped: [
      ...skipped,
      ...parsed.errors
        .filter((e) => e.rowNumber > 0)
        .map((e) => ({ rowNumber: e.rowNumber, name: "", reason: e.message })),
    ].sort((a, b) => a.rowNumber - b.rowNumber),
  };
  return NextResponse.json(summary, { status: 200 });
});
