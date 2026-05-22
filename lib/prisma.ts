import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

let rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
// Neon: si la URL contiene "-pooler", conectamos directo al compute
const connectionString = rawUrl.replace("-pooler", "");

if (!connectionString) {
  throw new Error("No está definida DIRECT_URL ni DATABASE_URL.");
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({
  connectionString,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}