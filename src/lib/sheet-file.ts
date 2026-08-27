import Papa from "papaparse";
import { findHeaderRowIndex } from "@/lib/csv-import";

/**
 * Client-side conversion of an uploaded spreadsheet (.xlsx/.xls) or .csv into
 * clean CSV text ready for the shop-import parser. Banner rows above the real
 * column header (report title, salesman line, beat line — as on distributor
 * loading slips) are trimmed off, so the first emitted line is the header row.
 * The xlsx parser is loaded on demand to keep it out of the main bundle.
 */
export async function fileToShopsCsv(file: File): Promise<string> {
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";

  let rows: unknown[][];
  if (isCsv) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    rows = parsed.data;
  } else {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("The workbook has no sheets");
    // raw:false keeps the on-screen formatting (dates, padded bill numbers).
    rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });
  }

  const headerIndex = findHeaderRowIndex(rows);
  if (headerIndex < 0) {
    throw new Error(
      "No header row found — the sheet needs a column named Party, Name, or Shop",
    );
  }

  const cells = rows
    .slice(headerIndex)
    .map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
  return Papa.unparse(cells);
}
