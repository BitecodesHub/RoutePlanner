import Papa from "papaparse";
import { haversineMeters, isValidCoordinate, parseGoogleMapsUrl } from "@/lib/geo";

/**
 * CSV import pipeline: tolerant header mapping, per-row validation,
 * in-file duplicate detection, and database duplicate matching.
 */

export interface ParsedShopRow {
  rowNumber: number; // 1-based data row number (excluding header)
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  contactName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  externalRef?: string;
}

export interface RowError {
  rowNumber: number;
  message: string;
}

export interface CsvParseResult {
  valid: ParsedShopRow[];
  errors: RowError[];
  duplicatesInFile: RowError[];
  totalRows: number;
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "shopname", "shop", "party", "partyname", "storename", "store", "outlet"],
  address: ["address", "addr", "location", "area", "fulladdress"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon", "long"],
  contactName: ["contactname", "contact", "contactperson", "owner", "ownername"],
  phone: ["phone", "mobile", "phoneno", "contactno", "mobileno", "tel", "phonenumber"],
  email: ["email", "emailaddress", "mail"],
  notes: ["notes", "note", "remarks", "comment", "comments"],
  externalRef: ["billno", "externalref", "ref", "code", "accountno", "shopcode"],
  mapsLink: ["googlemapslink", "mapslink", "maplink", "googlemaps", "link", "mapurl"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildHeaderMap(headers: string[]): Map<string, string> {
  // Maps canonical field -> actual CSV header. First alias match wins.
  const map = new Map<string, string>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const header of headers) {
      if (aliases.includes(normalizeHeader(header))) {
        map.set(field, header);
        break;
      }
    }
  }
  return map;
}

function cleanCell(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export function normalizeShopName(name: string): string {
  // Unicode-aware: keep letters and digits in any script, drop separators,
  // punctuation, and symbols. Falls back to the trimmed lowercase name so a
  // fully non-alphanumeric name never collapses to the empty string (which
  // would make all such names "duplicates" of each other).
  const key = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  return key || name.trim().toLowerCase();
}

const DUPLICATE_RADIUS_M = 50;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseShopsCsv(content: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const headerMap = buildHeaderMap(headers);

  if (!headerMap.has("name")) {
    return {
      valid: [],
      errors: [{ rowNumber: 0, message: "No shop-name column found (expected a header such as Name, Shop, or Party)" }],
      duplicatesInFile: [],
      totalRows: 0,
    };
  }

  const get = (row: Record<string, string>, field: string): string => {
    const header = headerMap.get(field);
    return header ? cleanCell(row[header]) : "";
  };

  const valid: ParsedShopRow[] = [];
  const errors: RowError[] = [];
  const duplicatesInFile: RowError[] = [];
  const seen: { key: string; lat: number; lng: number; ref?: string }[] = [];

  let rowNumber = 0;
  for (const row of parsed.data) {
    rowNumber++;
    const name = get(row, "name");
    const allEmpty = Object.values(row).every((v) => cleanCell(v) === "");
    if (allEmpty) continue;

    if (!name) {
      errors.push({ rowNumber, message: "Missing shop name" });
      continue;
    }
    // Repeated header row embedded in the file body.
    if (normalizeShopName(name) === "party" || normalizeShopName(name) === "name") {
      errors.push({ rowNumber, message: "Looks like a repeated header row — skipped" });
      continue;
    }

    let lat = parseFloat(get(row, "latitude"));
    let lng = parseFloat(get(row, "longitude"));

    if (!isValidCoordinate(lat, lng)) {
      // Try to recover coordinates from an embedded Google Maps link.
      const link = get(row, "mapsLink");
      const fromLink = link ? parseGoogleMapsUrl(link) : null;
      if (fromLink) {
        lat = fromLink.lat;
        lng = fromLink.lng;
      } else {
        errors.push({
          rowNumber,
          message: `"${name}": missing or invalid coordinates`,
        });
        continue;
      }
    }

    const email = get(row, "email");
    if (email && !EMAIL_RE.test(email)) {
      errors.push({ rowNumber, message: `"${name}": invalid email address` });
      continue;
    }

    const externalRef = get(row, "externalRef") || undefined;
    const nameKey = normalizeShopName(name);

    const dupe = seen.find(
      (s) =>
        (externalRef && s.ref && s.ref === externalRef) ||
        (s.key === nameKey &&
          haversineMeters({ lat, lng }, { lat: s.lat, lng: s.lng }) <= DUPLICATE_RADIUS_M),
    );
    if (dupe) {
      duplicatesInFile.push({ rowNumber, message: `"${name}": duplicate of an earlier row in this file` });
      continue;
    }
    seen.push({ key: nameKey, lat, lng, ref: externalRef });

    valid.push({
      rowNumber,
      name,
      address: get(row, "address") || undefined,
      latitude: lat,
      longitude: lng,
      contactName: get(row, "contactName") || undefined,
      phone: get(row, "phone") || undefined,
      email: email || undefined,
      notes: get(row, "notes") || undefined,
      externalRef,
    });
  }

  return { valid, errors, duplicatesInFile, totalRows: rowNumber };
}

export interface ExistingShopLite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  externalRef: string | null;
}

/**
 * Split parsed rows into new records vs duplicates of shops already in the
 * database (same external ref, or same normalised name within 50 m).
 */
export function partitionAgainstExisting(
  rows: ParsedShopRow[],
  existing: ExistingShopLite[],
): { fresh: ParsedShopRow[]; duplicates: { row: ParsedShopRow; existingId: string }[] } {
  const byRef = new Map<string, ExistingShopLite>();
  const byName = new Map<string, ExistingShopLite[]>();
  for (const s of existing) {
    if (s.externalRef) byRef.set(s.externalRef, s);
    const key = normalizeShopName(s.name);
    const list = byName.get(key) ?? [];
    list.push(s);
    byName.set(key, list);
  }

  const fresh: ParsedShopRow[] = [];
  const duplicates: { row: ParsedShopRow; existingId: string }[] = [];

  for (const row of rows) {
    const refMatch = row.externalRef ? byRef.get(row.externalRef) : undefined;
    if (refMatch) {
      duplicates.push({ row, existingId: refMatch.id });
      continue;
    }
    const candidates = byName.get(normalizeShopName(row.name)) ?? [];
    const near = candidates.find(
      (c) =>
        haversineMeters(
          { lat: row.latitude, lng: row.longitude },
          { lat: c.latitude, lng: c.longitude },
        ) <= DUPLICATE_RADIUS_M,
    );
    if (near) {
      duplicates.push({ row, existingId: near.id });
    } else {
      fresh.push(row);
    }
  }

  return { fresh, duplicates };
}
