import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/** Minimal deterministic fixture for API tests. */

const prisma = new PrismaClient();

async function main() {
  await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Test Admin",
      role: "ADMIN",
      passwordHash: await bcrypt.hash("AdminTest@123", 10),
    },
  });
  await prisma.user.create({
    data: {
      email: "driver1@test.local",
      name: "Test Driver",
      role: "DRIVER",
      passwordHash: await bcrypt.hash("DriverTest@123", 10),
    },
  });

  const shops = [
    { name: "Alpha Store", latitude: 23.0634, longitude: 72.512, externalRef: "T1" },
    { name: "Beta Mart", latitude: 23.0725, longitude: 72.5086, externalRef: "T2" },
    { name: "Gamma Dairy", latitude: 23.0740, longitude: 72.5059, externalRef: "T3" },
    { name: "Delta Parlour", latitude: 23.0705, longitude: 72.5139, externalRef: "T4" },
    { name: "Epsilon Kirana", latitude: 23.0885, longitude: 72.4918, externalRef: "T5" },
  ];
  for (const s of shops) {
    await prisma.shop.create({ data: { ...s, address: `${s.name} address` } });
  }
  console.log("test fixture ready");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
