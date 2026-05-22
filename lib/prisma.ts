import { PrismaClient } from "@prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";

const connectionString =
  process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("No está definida DIRECT_URL ni DATABASE_URL.");
}

const adapter = new PrismaNeonHttp(connectionString, {});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}