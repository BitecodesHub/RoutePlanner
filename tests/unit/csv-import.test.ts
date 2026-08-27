import { describe, expect, it } from "vitest";
import { findHeaderRowIndex, parseShopsCsv, partitionAgainstExisting } from "@/lib/csv-import";
import { readFileSync } from "fs";
import { join } from "path";

describe("parseShopsCsv", () => {
  it("imports a standard file", () => {
    const csv = `Name,Address,Latitude,Longitude,Phone,Email
Shop A,12 Main St,23.06,72.51,+91 90000 00001,a@example.com
Shop B,34 Side St,23.07,72.52,,`;
    const r = parseShopsCsv(csv);
    expect(r.valid).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
    expect(r.valid[0]).toMatchObject({
      name: "Shop A",
      latitude: 23.06,
      longitude: 72.51,
      email: "a@example.com",
    });
  });

  it("maps alternative headers (Party, Lat, Lng, Bill No)", () => {
    const csv = `Party,Lat,Lng,Bill No
MILK & MORE,23.0634,72.5120,2607640`;
    const r = parseShopsCsv(csv);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].name).toBe("MILK & MORE");
    expect(r.valid[0].externalRef).toBe("2607640");
  });

  it("recovers coordinates from a Google Maps link when lat/lng are missing", () => {
    const csv = `Party,Latitude,Longitude,Google Maps Link
LinkShop,,,"https://www.google.com/maps/dir/?api=1&destination=23.0705,72.5139&travelmode=driving"`;
    const r = parseShopsCsv(csv);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].latitude).toBeCloseTo(23.0705);
    expect(r.valid[0].longitude).toBeCloseTo(72.5139);
  });

  it("rejects rows with missing name, bad coordinates, or bad email", () => {
    const csv = `Name,Latitude,Longitude,Email
,23.06,72.51,
BadCoords,95,72.51,
BadEmail,23.06,72.51,not-an-email
Good,23.06,72.51,ok@example.com`;
    const r = parseShopsCsv(csv);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].name).toBe("Good");
    expect(r.errors).toHaveLength(3);
  });

  it("detects in-file duplicates by name+proximity and by external ref", () => {
    const csv = `Name,Latitude,Longitude,Bill No
Shop X,23.0600,72.5100,111
Shop X,23.06001,72.51001,
Other,23.9,72.9,111
Far Shop X,23.5,72.9,`;
    const r = parseShopsCsv(csv);
    expect(r.valid.map((v) => v.name)).toEqual(["Shop X", "Far Shop X"]);
    expect(r.duplicatesInFile).toHaveLength(2);
  });

  it("fails cleanly when no name column exists", () => {
    const r = parseShopsCsv(`Foo,Bar\n1,2`);
    expect(r.valid).toHaveLength(0);
    expect(r.errors[0].message).toContain("No shop-name column");
  });

  it("handles the real seed file with a junk section and repeated header", () => {
    const csv = readFileSync(join(__dirname, "../../prisma/seed-shops.csv"), "utf8");
    const r = parseShopsCsv(csv);
    expect(r.valid).toHaveLength(20);
    // 3 NOT FOUND rows + 1 section-title row + 1 repeated header row
    expect(r.errors).toHaveLength(5);
    expect(r.duplicatesInFile).toHaveLength(0);
  });

  it("handles an empty file", () => {
    const r = parseShopsCsv("");
    expect(r.valid).toHaveLength(0);
  });

  it("does not collapse distinct non-Latin names into duplicates", () => {
    const csv = `Name,Latitude,Longitude
શ્રી ગણેશ સ્ટોર,23.06,72.51
શ્રી કૃષ્ણ ડેરી,23.0601,72.5101
पटेल किराना,23.0602,72.5102`;
    const r = parseShopsCsv(csv);
    expect(r.valid).toHaveLength(3);
    expect(r.duplicatesInFile).toHaveLength(0);
  });

  it("still detects duplicates for identical non-Latin names nearby", () => {
    const csv = `Name,Latitude,Longitude
શ્રી ગણેશ સ્ટોર,23.06,72.51
શ્રી ગણેશ સ્ટોર,23.06001,72.51001`;
    const r = parseShopsCsv(csv);
    expect(r.valid).toHaveLength(1);
    expect(r.duplicatesInFile).toHaveLength(1);
  });
});

describe("partitionAgainstExisting", () => {
  const existing = [
    { id: "s1", name: "Milk & More", latitude: 23.0634, longitude: 72.512, externalRef: "B1" },
  ];

  it("flags DB duplicates by external ref", () => {
    const rows = parseShopsCsv(`Name,Latitude,Longitude,Bill No\nSomething,23.9,72.9,B1`).valid;
    const { fresh, duplicates } = partitionAgainstExisting(rows, existing);
    expect(fresh).toHaveLength(0);
    expect(duplicates[0].existingId).toBe("s1");
  });

  it("flags DB duplicates by normalised name within 50 m", () => {
    const rows = parseShopsCsv(`Name,Latitude,Longitude\nMILK & MORE,23.06341,72.51201`).valid;
    const { duplicates } = partitionAgainstExisting(rows, existing);
    expect(duplicates).toHaveLength(1);
  });

  it("keeps same-name shops that are far apart", () => {
    const rows = parseShopsCsv(`Name,Latitude,Longitude\nMilk & More,23.20,72.60`).valid;
    const { fresh } = partitionAgainstExisting(rows, existing);
    expect(fresh).toHaveLength(1);
  });
});

describe("loading-slip support", () => {
  const slip = `Sr.,Date,Bill No,Party,Debit,Longitude,Latitude
"Beat :  AMUL (APO),SCIENCE CITY ROAD",,,,,,
Sr.,Date,Bill No,Party,Debit,Longitude,Latitude
1,21/08/26,2607590,SHIV CORNER - THALTEJ,0,0.0000000,0.0000000
2,21/08/26,2607638,URBAN ZEST MART,1642,72.4779617,23.0929133
,,,Total,235755,,`;

  it("keeps coordinate-less rows separately with requireCoords: false", () => {
    const r = parseShopsCsv(slip, { requireCoords: false });
    expect(r.valid.map((v) => v.name)).toEqual(["URBAN ZEST MART"]);
    expect(r.valid[0].latitude).toBeCloseTo(23.0929133);
    expect(r.coordless.map((v) => v.name)).toEqual(["SHIV CORNER - THALTEJ"]);
    expect(r.coordless[0].externalRef).toBe("2607590");
  });

  it("rejects coordinate-less rows by default and skips totals/header rows", () => {
    const r = parseShopsCsv(slip);
    expect(r.valid.map((v) => v.name)).toEqual(["URBAN ZEST MART"]);
    expect(r.coordless).toHaveLength(0);
    const messages = r.errors.map((e) => e.message).join(" | ");
    expect(messages).toContain("totals row");
    expect(messages).toContain("repeated header row");
  });

  it("dedupes coordinate-less rows by name alone in loose mode", () => {
    const csv = `Party,Latitude,Longitude\nShiv Corner,,\nSHIV CORNER,,`;
    const r = parseShopsCsv(csv, { requireCoords: false });
    expect(r.coordless).toHaveLength(1);
    expect(r.duplicatesInFile).toHaveLength(1);
  });
});

describe("findHeaderRowIndex", () => {
  it("finds the header row below banner rows", () => {
    const rows = [
      ["AAROGYA SALES -2026-27"],
      ["Loading Slip"],
      ["Salesman : MEHUL PATEL"],
      ["Sr.", "Date", "Bill No", "Party", "Debit", "Longitude", "Latitude"],
      [1, "21/08/26", "2607590", "SHIV CORNER", 0, 0, 0],
    ];
    expect(findHeaderRowIndex(rows)).toBe(3);
  });

  it("returns -1 when no name-like column exists", () => {
    expect(findHeaderRowIndex([["a", "b"], [1, 2]])).toBe(-1);
  });
});
