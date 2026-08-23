import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { join } from "path";
import { parseShopsCsv } from "../src/lib/csv-import";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin@12345";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Administrator",
      role: "ADMIN",
      passwordHash: await bcrypt.hash(adminPassword, 12),
    },
  });
  console.log(`Admin ready: ${adminEmail}`);

  const driverEmail = "driver@example.com";
  await prisma.user.upsert({
    where: { email: driverEmail },
    update: {},
    create: {
      email: driverEmail,
      name: "Demo Driver",
      role: "DRIVER",
      phone: "+91 90000 00000",
      passwordHash: await bcrypt.hash("Driver@12345", 12),
    },
  });
  console.log(`Demo driver ready: ${driverEmail}`);

  const shopCount = await prisma.shop.count();
  if (shopCount === 0) {
    let csv = "";
    try {
      csv = readFileSync(join(__dirname, "seed-shops.csv"), "utf8");
    } catch {
      console.log("No seed-shops.csv found — skipping shop seed.");
    }
    if (csv) {
      const parsed = parseShopsCsv(csv);
      const batch = await prisma.importBatch.create({
        data: {
          filename: "seed-shops.csv",
          totalRows: parsed.totalRows,
          imported: parsed.valid.length,
          skippedDuplicates: parsed.duplicatesInFile.length,
          invalid: parsed.errors.length,
          errors: JSON.stringify([...parsed.errors, ...parsed.duplicatesInFile]),
          createdById: admin.id,
        },
      });
      for (const row of parsed.valid) {
        await prisma.shop.create({
          data: {
            name: row.name,
            address: row.address,
            latitude: row.latitude,
            longitude: row.longitude,
            contactName: row.contactName,
            phone: row.phone,
            email: row.email,
            notes: row.notes,
            externalRef: row.externalRef,
            importBatchId: batch.id,
          },
        });
      }
      console.log(
        `Seeded ${parsed.valid.length} shops (${parsed.errors.length} invalid rows skipped, ${parsed.duplicatesInFile.length} in-file duplicates).`,
      );
    }
  } else {
    console.log(`Shops already present (${shopCount}) — skipping shop seed.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
